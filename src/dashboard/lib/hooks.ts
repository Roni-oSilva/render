import { useCallback, useEffect, useState } from 'react';

/** Carrega dados e atualiza automaticamente a cada `everyMs`. */
export function useAuto<T>(fn: () => Promise<T>, deps: unknown[] = [], everyMs = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try { setData(await fn()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, deps);
  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, loading, reload: load };
}
