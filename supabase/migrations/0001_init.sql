-- Render Guardian — esquema inicial
create extension if not exists pgcrypto;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  url text not null check (char_length(url) <= 2048),
  description text check (char_length(description) <= 500),
  interval_minutes int not null default 5 check (interval_minutes in (5,10,15,20,25,30)),
  timeout_seconds int not null default 10 check (timeout_seconds between 1 and 60),
  expected_status text not null default '200-299' check (char_length(expected_status) <= 100),
  keyword text check (char_length(keyword) <= 200),
  max_attempts int not null default 2 check (max_attempts between 1 and 5),
  failure_threshold int not null default 3 check (failure_threshold between 1 and 20),
  max_redirects int not null default 5 check (max_redirects between 0 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- estado operacional (atualizado só pelo executor)
  consecutive_failures int not null default 0,
  last_result text check (last_result in ('up','down','timeout','config_error')),
  last_slow boolean not null default false,
  last_latency_ms int,
  last_status_code int,
  last_error text,
  last_checked_at timestamptz,
  last_incident_at timestamptz
);

create table public.monitor_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'schedule',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  services_processed int not null default 0,
  services_failed int not null default 0,
  internal_failures int not null default 0,
  duration_ms int,
  error text
);
create index monitor_runs_started_idx on public.monitor_runs (started_at desc);

create table public.check_results (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  run_id uuid references public.monitor_runs(id) on delete set null,
  checked_at timestamptz not null default now(),
  result text not null check (result in ('up','down','timeout','config_error')),
  slow boolean not null default false,
  status_code int,
  latency_ms int,
  error_kind text,
  error_message text,
  attempt int not null default 1,
  final boolean not null default true, -- resultado final do ciclo (após tentativas)
  unique (run_id, service_id, attempt)
);
create index check_results_service_time_idx on public.check_results (service_id, checked_at desc);
create index check_results_time_idx on public.check_results (checked_at desc);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  opened_at timestamptz not null default now(),
  first_failure_at timestamptz not null,
  resolved_at timestamptz,
  last_error text,
  open_alert_sent boolean not null default false,
  recovery_alert_sent boolean not null default false
);
-- no máximo um incidente aberto por serviço (idempotência)
create unique index incidents_one_open_idx on public.incidents (service_id) where resolved_at is null;
create index incidents_opened_idx on public.incidents (opened_at desc);

create table public.settings (
  id int primary key default 1 check (id = 1),
  retention_days int not null default 30 check (retention_days between 1 and 365),
  slow_threshold_ms int not null default 3000 check (slow_threshold_ms between 100 and 60000),
  stale_after_minutes int not null default 20 check (stale_after_minutes between 6 and 1440),
  monitor_alerted_at timestamptz
);
insert into public.settings (id) values (1);

create table public.monitor_state (
  id int primary key default 1 check (id = 1),
  lock_holder text,
  lock_expires_at timestamptz,
  last_heartbeat_at timestamptz
);
insert into public.monitor_state (id) values (1);

-- Limite de 5 serviços (requisito inicial); ajuste aqui se necessário.
create function public.enforce_service_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.services) >= 5 then
    raise exception 'Limite de 5 serviços atingido';
  end if;
  return new;
end $$;
create trigger services_limit before insert on public.services
  for each row execute function public.enforce_service_limit();

-- Proteção: o painel não pode alterar o estado operacional escrito pelo executor.
create function public.protect_service_state() returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    new.consecutive_failures := old.consecutive_failures;
    new.last_result := old.last_result;
    new.last_slow := old.last_slow;
    new.last_latency_ms := old.last_latency_ms;
    new.last_status_code := old.last_status_code;
    new.last_error := old.last_error;
    new.last_checked_at := old.last_checked_at;
    new.last_incident_at := old.last_incident_at;
  end if;
  return new;
end $$;
create trigger services_protect_state before update on public.services
  for each row execute function public.protect_service_state();

-- Controle de concorrência (lease atômico)
create function public.acquire_lease(p_holder text, p_ttl_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update monitor_state
     set lock_holder = p_holder,
         lock_expires_at = now() + make_interval(secs => p_ttl_seconds),
         last_heartbeat_at = now()
   where id = 1 and (lock_holder is null or lock_expires_at < now() or lock_holder = p_holder);
  return found;
end $$;

create function public.release_lease(p_holder text) returns void
language sql security definer set search_path = public as $$
  update monitor_state set lock_holder = null, lock_expires_at = null, last_heartbeat_at = now()
  where id = 1 and lock_holder = p_holder;
$$;

create function public.purge_old_checks(p_days int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from check_results where checked_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from monitor_runs where started_at < now() - make_interval(days => p_days);
  delete from incidents where resolved_at is not null and resolved_at < now() - make_interval(days => p_days);
  return n;
end $$;

revoke all on function public.acquire_lease(text,int), public.release_lease(text), public.purge_old_checks(int)
  from public, anon, authenticated;
grant execute on function public.acquire_lease(text,int), public.release_lease(text), public.purge_old_checks(int)
  to service_role;

-- Estatísticas agregadas para o painel (respeitam RLS do chamador)
create function public.service_stats(p_since timestamptz)
returns table (service_id uuid, total bigint, ok bigint, avg_latency numeric, first_at timestamptz)
language sql stable security invoker as $$
  select service_id, count(*), count(*) filter (where result = 'up'),
         avg(latency_ms) filter (where result = 'up'), min(checked_at)
  from check_results
  where checked_at >= p_since and final
  group by service_id;
$$;

create function public.daily_stats(p_service uuid, p_since timestamptz)
returns table (day date, total bigint, ok bigint)
language sql stable security invoker as $$
  select (checked_at at time zone 'America/Sao_Paulo')::date, count(*), count(*) filter (where result = 'up')
  from check_results
  where service_id = p_service and checked_at >= p_since and final
  group by 1 order by 1;
$$;

-- RLS: uso individual. DESATIVE novos cadastros em Authentication > Sign In / Providers
-- e crie apenas o seu usuário; as políticas valem para qualquer usuário autenticado.
alter table public.services enable row level security;
alter table public.monitor_runs enable row level security;
alter table public.check_results enable row level security;
alter table public.incidents enable row level security;
alter table public.settings enable row level security;
alter table public.monitor_state enable row level security;

create policy services_all on public.services for all to authenticated using (true) with check (true);
create policy runs_read on public.monitor_runs for select to authenticated using (true);
create policy checks_read on public.check_results for select to authenticated using (true);
create policy incidents_read on public.incidents for select to authenticated using (true);
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (true) with check (true);
create policy state_read on public.monitor_state for select to authenticated using (true);

-- anon não tem nenhuma política => sem acesso.
revoke all on all tables in schema public from anon;
