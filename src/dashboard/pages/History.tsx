import { useState } from 'react';
import { api, type HistoryFilter } from '../lib/api';
import { useAuto } from '../lib/hooks';
import { RESULT_LABEL, fmtDateTime } from '../lib/format';
import { toCsv } from '../../shared/csv';

const SIZE = 25;

export default function HistoryPage() {
  const [f, setF] = useState<HistoryFilter>({ serviceId: '', result: '', from: '', to: '', onlyFinal: true });
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const svc = useAuto(api.services, [], 120_000);
  const h = useAuto(() => api.history(f, page, SIZE), [JSON.stringify(f), page], 30_000);
  const name = (id: string) => svc.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const set = (p: Partial<HistoryFilter>) => { setF((x) => ({ ...x, ...p })); setPage(0); };
  const pages = Math.max(1, Math.ceil((h.data?.count ?? 0) / SIZE));

  const exportCsv = async () => {
    setBusy(true);
    try {
      const rows = (await api.historyAll(f)).map((r) => ({ ...r, servico: name(r.service_id), checked_at_brt: fmtDateTime(r.checked_at) }));
      const csv = toCsv(['servico', 'checked_at', 'checked_at_brt', 'result', 'slow', 'status_code', 'latency_ms', 'error_kind', 'error_message', 'attempt', 'run_id'], rows);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `historico-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="card grid gap-3 md:grid-cols-6">
        <div><label className="label">Serviço</label><select className="input" value={f.serviceId} onChange={(e) => set({ serviceId: e.target.value })}><option value="">Todos</option>{svc.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label">Resultado</label><select className="input" value={f.result} onChange={(e) => set({ result: e.target.value })}><option value="">Todos</option>{Object.entries(RESULT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label">De</label><input type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} /></div>
        <div><label className="label">Até</label><input type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.onlyFinal} onChange={(e) => set({ onlyFinal: e.target.checked })} />Só resultado final</label>
        <div className="flex items-end"><button className="btn w-full" onClick={exportCsv} disabled={busy}>{busy ? 'Exportando…' : 'Exportar CSV'}</button></div>
      </div>
      {h.error && <p className="text-sm text-red-600">{h.error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th>Horário (Brasília)</th><th>Serviço</th><th>Resultado</th><th>HTTP</th><th>Latência</th><th>Tentativa</th><th>Motivo</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {h.data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateTime(r.checked_at)}</td><td>{name(r.service_id)}</td>
                <td className={r.result === 'up' ? 'text-emerald-700' : 'text-red-700'}>{RESULT_LABEL[r.result]}{r.slow ? ' (lento)' : ''}</td>
                <td>{r.status_code ?? '—'}</td><td>{r.latency_ms !== null ? `${r.latency_ms} ms` : '—'}</td><td>{r.attempt}</td><td className="text-xs">{r.error_message ?? ''}</td>
              </tr>
            ))}
            {!h.loading && !h.data?.rows.length && <tr><td colSpan={7} className="text-slate-500">Sem registros para os filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">{h.data?.count ?? 0} registro(s)</span>
        <div className="flex items-center gap-2">
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>{page + 1} / {pages}</span>
          <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      </div>
    </div>
  );
}
