import { useState } from 'react';
import { api } from '../lib/api';
import { useAuto } from '../lib/hooks';
import { HEALTH_UI, serviceHealth } from '../lib/format';
import { INTERVALS, type Service } from '../../shared/types';
import { validateServiceInput, type ServiceInput } from '../../shared/validation';

const EMPTY: ServiceInput = {
  name: '', url: 'https://', description: '', interval_minutes: 5, timeout_seconds: 10, expected_status: '200-299',
  keyword: '', max_attempts: 2, failure_threshold: 3, max_redirects: 5, active: true,
};

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}{error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}</div>;
}

function Form({ initial, id, onDone }: { initial: ServiceInput; id: string | null; onDone: () => void }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ServiceInput>(k: K, val: ServiceInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const num = (k: keyof ServiceInput) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <form className="card grid gap-3 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = validateServiceInput(v);
      if (!r.ok) { setErrors(r.errors); return; }
      setErrors({}); setBusy(true); setMsg('');
      try { await api.saveService(id, r.value); onDone(); } catch (x) { setMsg(x instanceof Error ? x.message : 'Erro ao salvar'); } finally { setBusy(false); }
    }}>
      <Field label="Nome" error={errors.name}><input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="md:col-span-2"><Field label="URL (http/https)" error={errors.url}><input className="input" value={v.url} onChange={(e) => set('url', e.target.value)} /></Field></div>
      <div className="md:col-span-3"><Field label="Descrição (opcional)" error={errors.description}><input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field></div>
      <Field label="Intervalo" error={errors.interval_minutes}>
        <select className="input" value={v.interval_minutes} onChange={num('interval_minutes') as never}>{INTERVALS.map((i) => <option key={i} value={i}>{i} minutos</option>)}</select>
      </Field>
      <Field label="Timeout (s)" error={errors.timeout_seconds}><input className="input" type="number" value={v.timeout_seconds} onChange={num('timeout_seconds')} /></Field>
      <Field label="Códigos HTTP válidos" error={errors.expected_status}><input className="input" value={v.expected_status} onChange={(e) => set('expected_status', e.target.value)} /></Field>
      <Field label="Tentativas por verificação" error={errors.max_attempts}><input className="input" type="number" value={v.max_attempts} onChange={num('max_attempts')} /></Field>
      <Field label="Falhas consecutivas p/ incidente" error={errors.failure_threshold}><input className="input" type="number" value={v.failure_threshold} onChange={num('failure_threshold')} /></Field>
      <Field label="Máx. redirecionamentos" error={errors.max_redirects}><input className="input" type="number" value={v.max_redirects} onChange={num('max_redirects')} /></Field>
      <div className="md:col-span-3"><Field label="Palavra-chave esperada na resposta (opcional)" error={errors.keyword}><input className="input" value={v.keyword ?? ''} onChange={(e) => set('keyword', e.target.value)} /></Field></div>
      {msg && <p className="text-sm text-red-600 md:col-span-3">{msg}</p>}
      <div className="flex gap-2 md:col-span-3">
        <button className="btn-primary" disabled={busy}>{id ? 'Salvar alterações' : 'Adicionar serviço'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

export default function ServicesPage() {
  const svc = useAuto(api.services, [], 15_000);
  const inc = useAuto(api.openIncidents, [], 15_000);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [err, setErr] = useState('');
  const open = new Set((inc.data ?? []).map((i) => i.service_id));
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await svc.reload(); } catch (e) { setErr(e instanceof Error ? e.message : 'Erro'); } };

  if (editing) {
    const s = editing === 'new' ? null : editing;
    const initial: ServiceInput = s ? { ...s } : EMPTY;
    return <Form initial={initial} id={s?.id ?? null} onDone={() => { setEditing(null); void svc.reload(); }} />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Serviços ({svc.data?.length ?? 0}/5)</h2>
        <button className="btn-primary" onClick={() => setEditing('new')} disabled={(svc.data?.length ?? 0) >= 5}>Novo serviço</button>
      </div>
      {(err || svc.error) && <p className="text-sm text-red-600">{err || svc.error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th>Nome</th><th>URL</th><th>Intervalo</th><th>Status</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(svc.data ?? []).map((s) => {
              const ui = HEALTH_UI[serviceHealth(s, open.has(s.id))];
              return (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="max-w-[18rem] truncate">{s.url}</td>
                  <td>{s.interval_minutes} min</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>{ui.label}</span></td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    <button className="btn" onClick={() => setEditing(s)}>Editar</button>
                    <button className="btn" onClick={() => act(() => api.setActive(s.id, !s.active))}>{s.active ? 'Pausar' : 'Reativar'}</button>
                    <button className="btn-danger" onClick={() => { if (confirm(`Excluir "${s.name}" e todo o seu histórico? Esta ação não pode ser desfeita.`)) void act(() => api.deleteService(s.id)); }}>Excluir</button>
                  </td>
                </tr>
              );
            })}
            {!svc.data?.length && <tr><td colSpan={5} className="text-slate-500">Nenhum serviço cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
