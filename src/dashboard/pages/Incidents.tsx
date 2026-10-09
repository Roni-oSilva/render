import { useState } from 'react';
import { api } from '../lib/api';
import { useAuto } from '../lib/hooks';
import { fmtDateTime, fmtDuration } from '../lib/format';

const SIZE = 20;

export default function IncidentsPage() {
  const [page, setPage] = useState(0);
  const svc = useAuto(api.services, [], 120_000);
  const inc = useAuto(() => api.incidents(page, SIZE), [page], 30_000);
  const name = (id: string) => svc.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const pages = Math.max(1, Math.ceil((inc.data?.count ?? 0) / SIZE));
  return (
    <div className="space-y-3">
      {inc.error && <p className="text-sm text-red-600">{inc.error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th>Serviço</th><th>Primeira falha</th><th>Recuperação</th><th>Duração estimada</th><th>Último erro</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {inc.data?.rows.map((i) => {
              const end = i.resolved_at ? Date.parse(i.resolved_at) : Date.now();
              return (
                <tr key={i.id}>
                  <td className="font-medium">{name(i.service_id)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(i.first_failure_at)}</td>
                  <td className="whitespace-nowrap">{i.resolved_at ? fmtDateTime(i.resolved_at) : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Em andamento</span>}</td>
                  <td>{fmtDuration(end - Date.parse(i.first_failure_at))}</td>
                  <td className="text-xs">{i.last_error ?? ''}</td>
                </tr>
              );
            })}
            {!inc.loading && !inc.data?.rows.length && <tr><td colSpan={5} className="text-slate-500">Nenhum incidente registrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Durações são estimadas entre a primeira falha observada e a primeira verificação bem-sucedida.</p>
      <div className="flex items-center justify-end gap-2 text-sm">
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
        <span>{page + 1} / {pages}</span>
        <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>
    </div>
  );
}
