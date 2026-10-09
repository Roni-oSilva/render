import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './lib/supabase';
import Dashboard from './pages/Dashboard';
import ServicesPage from './pages/Services';
import HistoryPage from './pages/History';
import IncidentsPage from './pages/Incidents';
import SettingsPage from './pages/SettingsPage';

const TABS = [
  ['painel', 'Painel'], ['servicos', 'Serviços'], ['historico', 'Histórico'], ['incidentes', 'Incidentes'], ['config', 'Configurações'],
] as const;

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <form className="card space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr('Credenciais inválidas'); setBusy(false);
      }}>
        <h1 className="text-lg font-semibold">Render Guardian</h1>
        <div><label className="label">E-mail</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label">Senha</label><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>Entrar</button>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('painel');
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) return <p className="m-8 text-red-700">Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build.</p>;
  if (session === undefined) return <p className="m-8 text-slate-500">Carregando…</p>;
  if (!session) return <Login />;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <h1 className="text-xl font-bold">🛡️ Render Guardian</h1>
        <nav className="flex flex-wrap gap-1">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-indigo-600 text-white' : 'hover:bg-slate-200'}`}>{l}</button>
          ))}
          <button className="btn ml-2" onClick={() => supabase.auth.signOut()}>Sair</button>
        </nav>
      </header>
      {tab === 'painel' && <Dashboard />}
      {tab === 'servicos' && <ServicesPage />}
      {tab === 'historico' && <HistoryPage />}
      {tab === 'incidentes' && <IncidentsPage />}
      {tab === 'config' && <SettingsPage />}
    </div>
  );
}
