import { INTERVALS } from './types';
import { parseStatusSpec } from './status';
import { validateUrlSyntax } from '../security/url';

export interface ServiceInput {
  name: string;
  url: string;
  description?: string | null;
  interval_minutes: number;
  timeout_seconds: number;
  expected_status: string;
  keyword?: string | null;
  max_attempts: number;
  failure_threshold: number;
  max_redirects: number;
  active: boolean;
}

export type Validation =
  | { ok: true; value: ServiceInput }
  | { ok: false; errors: Record<string, string> };

export function validateServiceInput(i: ServiceInput): Validation {
  const errors: Record<string, string> = {};
  const name = (i.name ?? '').trim();
  if (!name || name.length > 80) errors.name = 'Informe um nome de 1 a 80 caracteres';
  const u = validateUrlSyntax(i.url ?? '');
  if (!u.ok) errors.url = u.reason;
  if (!(INTERVALS as readonly number[]).includes(i.interval_minutes)) errors.interval_minutes = 'Intervalo deve ser 5, 10, 15, 20, 25 ou 30 minutos';
  const int = (v: number, a: number, b: number) => Number.isInteger(v) && v >= a && v <= b;
  if (!int(i.timeout_seconds, 1, 60)) errors.timeout_seconds = 'Timeout entre 1 e 60 segundos';
  if (!int(i.max_attempts, 1, 5)) errors.max_attempts = 'Tentativas entre 1 e 5';
  if (!int(i.failure_threshold, 1, 20)) errors.failure_threshold = 'Falhas consecutivas entre 1 e 20';
  if (!int(i.max_redirects, 0, 10)) errors.max_redirects = 'Redirecionamentos entre 0 e 10';
  if (!parseStatusSpec(i.expected_status ?? '')) errors.expected_status = 'Use o formato 200-299,301';
  if ((i.keyword ?? '').length > 200) errors.keyword = 'Palavra-chave com até 200 caracteres';
  if ((i.description ?? '').length > 500) errors.description = 'Descrição com até 500 caracteres';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...i,
      name,
      url: (u as { normalized: string }).normalized,
      description: i.description?.trim() || null,
      keyword: i.keyword?.trim() || null,
      expected_status: i.expected_status.replace(/\s+/g, ''),
    },
  };
}
