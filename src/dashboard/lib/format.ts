import type { CheckResult, Service } from '../../shared/types';

const TZ = 'America/Sao_Paulo';
export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const fmtShort = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

export const RESULT_LABEL: Record<CheckResult, string> = {
  up: 'Operacional', down: 'Falha', timeout: 'Timeout', config_error: 'Erro de configuração',
};

export type Health = 'paused' | 'waiting' | 'up' | 'slow' | 'degraded' | 'down';
export function serviceHealth(s: Service, hasOpenIncident: boolean): Health {
  if (!s.active) return 'paused';
  if (!s.last_result) return 'waiting';
  if (hasOpenIncident) return 'down';
  if (s.last_result !== 'up') return 'degraded';
  return s.last_slow ? 'slow' : 'up';
}

export const HEALTH_UI: Record<Health, { label: string; cls: string }> = {
  paused: { label: 'Pausado', cls: 'bg-slate-100 text-slate-600' },
  waiting: { label: 'Aguardando', cls: 'bg-slate-100 text-slate-600' },
  up: { label: 'Operacional', cls: 'bg-emerald-100 text-emerald-700' },
  slow: { label: 'Lento', cls: 'bg-amber-100 text-amber-700' },
  degraded: { label: 'Falhando', cls: 'bg-orange-100 text-orange-700' },
  down: { label: 'Indisponível', cls: 'bg-red-100 text-red-700' },
};
