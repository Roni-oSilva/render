import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuto } from '../lib/hooks';
import { HEALTH_UI, fmtDateTime, fmtDuration, fmtShort, serviceHealth } from '../lib/format';
import { evaluateHealth } from '../../monitor/watchdog';

const PERIODS = [['24 horas', 1], ['7 dias', 7], ['30 dias', 30]] as const;
const CRON_MINUTES = 5; // deve coincidir com .github/workflows/monitor.yml

function Stat({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return <div className="card"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div></div>;
}

export default function Dashboard() {
  const [days, setDays] = useState<number>(1);
  const [sel, setSel] = useState<string | null>(null);
  const since = useMemo(() => new Date(Date.now() - days * 86400_000).toISOString(), [days]);
  const svc = useAuto(api.services);
  const inc = useAuto(api.openIncidents);
  const run = useAuto(api.lastRun);
  const state = useAuto(api.monitorState);
  const cfg = useAuto(api.settings);
  const stats = useAuto(() => api.stats(since), [since]);

  const services = svc.data ?? [];
  const open = new Set((inc.data ?? []).map((i) => i.service_id));
  const health = services.map((s) => serviceHealth(s, open.has(s.id)));
  const count = (h: string) => health.filter((x) => x === h).length;
  const sId = sel ?? services[0]?.id ?? null;

  const lat = useAuto(() => (sId ? api.latency(sId) : Promise.resolve([])), [sId]);
  const daily = useAuto(() => (sId ? api.daily(sId, new Date(Date.now() - 30 * 86400_000).toISOString()) : Promise.resolve([])), [sId]);

  const mh = evaluateHealth(state.data?.last_heartbeat_at ?? null, Date.now(), cfg.data?.stale_after_minutes ?? 20);
  const mUi = { ok: ['Monitor saudável', 'bg-emerald-100 text-emerald-700'], late: ['Monitor atrasado', 'bg-red-100 text-red-700'], no_data: ['Monitor sem dados', 'bg-slate-100 text-slate-600'] }[mh];
  const nextEst = run.data ? new Date(Date.parse(run.data.started_at) + CRON_MINUTES * 60_000).toISOString() : null;
  const total = stats.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
  const ok = stats.data?.reduce((a, s) => a + Number(s.ok), 0) ?? 0;
  const firstAt = stats.data?.map((s) => s.first_at).sort()[0];

  const err = svc.error || inc.error || run.error || stats.error;
  return (
    <div className="space-y-4">
      {err && <p className="card border-red-300 text-sm text-red-700">Erro ao carregar dados: {err}</p>}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mUi[1]}`}>{mUi[0]}</span>
        <span>Última execução: <b>{fmtDateTime(run.data?.started_at ?? null)}</b> ({run.data?.status ?? '—'})</span>
        <span>Duração: <b>{fmtDuration(run.data?.duration_ms ?? null)}</b></span>
        <span>Próxima (estimada): <b>{fmtDateTime(nextEst)}</b></span>
        <span className="text-xs text-slate-500">Status do monitor ≠ status dos sites. O agendador do GitHub pode atrasar.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Serviços" value={services.length} />
        <Stat label="Operacionais" value={count('up')} tone="text-emerald-600" />
        <Stat label="Indisponíveis" value={count('down') + count('degraded')} tone="text-red-600" />
        <Stat label="Com lentidão" value={count('slow')} tone="text-amber-600" />
        <Stat label="Incidentes ativos" value={open.size} tone={open.size ? 'text-red-600' : ''} />
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Serviços</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Disponibilidade:</span>
            {PERIODS.map(([l, d]) => <button key={d} onClick={() => setDays(d)} className={`rounded px-2 py-0.5 ${days === d ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{l}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th>Serviço</th><th>Status</th><th>Latência</th><th>HTTP</th><th>Última verificação</th><th>Disponib.</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((s, i) => {
                const st = stats.data?.find((x) => x.service_id === s.id);
                const ui = HEALTH_UI[health[i]!];
                return (
                  <tr key={s.id} onClick={() => setSel(s.id)} className={`cursor-pointer hover:bg-slate-50 ${sId === s.id ? 'bg-indigo-50' : ''}`}>
                    <td><div className="font-medium">{s.name}</div><div className="max-w-[16rem] truncate text-xs text-slate-500">{s.url}</div></td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>{ui.label}</span>{s.last_error && s.last_result !== 'up' && <div className="mt-0.5 text-xs text-red-600">{s.last_error}</div>}</td>
                    <td>{s.last_latency_ms !== null ? `${s.last_latency_ms} ms` : '—'}</td>
                    <td>{s.last_status_code ?? '—'}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(s.last_checked_at)}</td>
                    <td>{st && Number(st.total) ? `${((Number(st.ok) / Number(st.total)) * 100).toFixed(2)}%` : '—'}</td>
                  </tr>
                );
              })}
              {!services.length && <tr><td colSpan={6} className="text-slate-500">Nenhum serviço cadastrado. Vá em “Serviços”.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Disponibilidade geral no período: {total ? `${((ok / total) * 100).toFixed(2)}% (${total} verificações)` : 'sem dados'}
          {firstAt && new Date(firstAt).getTime() > Date.parse(since) ? ` — histórico disponível apenas desde ${fmtDateTime(firstAt)}` : ''}.
        </p>
      </div>

      {sId && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Latência (últimas {lat.data?.length ?? 0} verificações) — {services.find((s) => s.id === sId)?.name}</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={(lat.data ?? []).map((r) => ({ t: fmtShort(r.checked_at), ms: r.result === 'up' ? r.latency_ms : null }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} unit=" ms" width={60} />
                  <Tooltip />
                  <Area type="monotone" dataKey="ms" name="Latência" stroke="#4f46e5" fill="#c7d2fe" connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Disponibilidade diária (30 dias; dias sem dados ficam vazios)</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={(daily.data ?? []).map((d) => ({ dia: d.day.slice(5).split('-').reverse().join('/'), pct: Number(d.total) ? +((Number(d.ok) / Number(d.total)) * 100).toFixed(2) : null }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" width={45} />
                  <Tooltip />
                  <Bar dataKey="pct" name="Disponibilidade" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
