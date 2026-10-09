import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuto } from '../lib/hooks';

export default function SettingsPage() {
  const cfg = useAuto(api.settings, [], 300_000);
  const [v, setV] = useState({ retention_days: 30, slow_threshold_ms: 3000, stale_after_minutes: 20 });
  const [msg, setMsg] = useState('');
  useEffect(() => { if (cfg.data) setV({ retention_days: cfg.data.retention_days, slow_threshold_ms: cfg.data.slow_threshold_ms, stale_after_minutes: cfg.data.stale_after_minutes }); }, [cfg.data]);
  const n = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <form className="card grid max-w-xl gap-3" onSubmit={async (e) => {
      e.preventDefault();
      if (v.retention_days < 1 || v.retention_days > 365 || v.slow_threshold_ms < 100 || v.stale_after_minutes < 6) { setMsg('Valores fora do intervalo permitido'); return; }
      try { await api.saveSettings(v); setMsg('Salvo.'); } catch (x) { setMsg(x instanceof Error ? x.message : 'Erro'); }
    }}>
      <div><label className="label">Retenção do histórico (dias, 1–365)</label><input className="input" type="number" value={v.retention_days} onChange={n('retention_days')} /></div>
      <div><label className="label">Limite de lentidão (ms)</label><input className="input" type="number" value={v.slow_threshold_ms} onChange={n('slow_threshold_ms')} /></div>
      <div><label className="label">Monitor considerado atrasado após (minutos, ≥ 6)</label><input className="input" type="number" value={v.stale_after_minutes} onChange={n('stale_after_minutes')} /></div>
      <p className="text-xs text-slate-500">Canais de alerta (Discord, e-mail, webhook) são configurados como segredos do GitHub — veja o README. Eles nunca passam pelo navegador.</p>
      {msg && <p className="text-sm">{msg}</p>}
      <button className="btn-primary w-fit">Salvar</button>
    </form>
  );
}
