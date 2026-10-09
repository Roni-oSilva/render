import { supabase } from './supabase';
import type { CheckRow, Incident, MonitorRun, MonitorState, Service, Settings } from '../../shared/types';
import type { ServiceInput } from '../../shared/validation';

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export interface Stat { service_id: string; total: number; ok: number; avg_latency: number | null; first_at: string }

export const api = {
  services: async () => check(await supabase.from('services').select('*').order('created_at')) as Service[],
  openIncidents: async () => check(await supabase.from('incidents').select('*').is('resolved_at', null)) as Incident[],
  incidents: async (page: number, size: number) => {
    const r = await supabase.from('incidents').select('*', { count: 'exact' }).order('opened_at', { ascending: false }).range(page * size, page * size + size - 1);
    return { rows: check(r) as Incident[], count: r.count ?? 0 };
  },
  lastRun: async () => check(await supabase.from('monitor_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle()) as MonitorRun | null,
  monitorState: async () => check(await supabase.from('monitor_state').select('*').eq('id', 1).single()) as MonitorState,
  settings: async () => check(await supabase.from('settings').select('*').eq('id', 1).single()) as Settings,
  saveSettings: async (s: Pick<Settings, 'retention_days' | 'slow_threshold_ms' | 'stale_after_minutes'>) =>
    check(await supabase.from('settings').update(s).eq('id', 1)),
  stats: async (sinceIso: string) => check(await supabase.rpc('service_stats', { p_since: sinceIso })) as Stat[],
  daily: async (serviceId: string, sinceIso: string) =>
    check(await supabase.rpc('daily_stats', { p_service: serviceId, p_since: sinceIso })) as Array<{ day: string; total: number; ok: number }>,
  latency: async (serviceId: string, limit = 200) => {
    const rows = check(await supabase.from('check_results').select('checked_at,latency_ms,result').eq('service_id', serviceId).eq('final', true)
      .order('checked_at', { ascending: false }).limit(limit)) as Array<Pick<CheckRow, 'checked_at' | 'latency_ms' | 'result'>>;
    return rows.reverse();
  },
  saveService: async (id: string | null, v: ServiceInput) =>
    id ? check(await supabase.from('services').update(v).eq('id', id)) : check(await supabase.from('services').insert(v)),
  setActive: async (id: string, active: boolean) => check(await supabase.from('services').update({ active }).eq('id', id)),
  deleteService: async (id: string) => check(await supabase.from('services').delete().eq('id', id)),
  history: async (f: HistoryFilter, page: number, size: number) => {
    const r = await historyQuery(f, true).range(page * size, page * size + size - 1);
    return { rows: check(r) as CheckRow[], count: r.count ?? 0 };
  },
  historyAll: async (f: HistoryFilter, max = 10000) => {
    const out: CheckRow[] = [];
    for (let from = 0; from < max; from += 1000) {
      const rows = check(await historyQuery(f, false).range(from, from + 999)) as CheckRow[];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  },
};

export interface HistoryFilter { serviceId: string; result: string; from: string; to: string; onlyFinal: boolean }

function historyQuery(f: HistoryFilter, count: boolean) {
  let q = supabase.from('check_results').select('*', count ? { count: 'exact' } : undefined).order('checked_at', { ascending: false });
  if (f.serviceId) q = q.eq('service_id', f.serviceId);
  if (f.result) q = q.eq('result', f.result);
  if (f.from) q = q.gte('checked_at', new Date(`${f.from}T00:00:00-03:00`).toISOString());
  if (f.to) q = q.lte('checked_at', new Date(`${f.to}T23:59:59-03:00`).toISOString());
  if (f.onlyFinal) q = q.eq('final', true);
  return q;
}
