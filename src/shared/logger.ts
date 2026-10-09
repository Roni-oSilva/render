const PATTERNS: RegExp[] = [
  /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/[^\s"']+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bre_[A-Za-z0-9_]{12,}/g, // chaves Resend
];

export function redact(text: string, secrets: Array<string | undefined> = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  for (const p of PATTERNS) out = out.replace(p, '[REDACTED]');
  return out;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(secrets: Array<string | undefined> = [], sink: (line: string) => void = console.log): Logger {
  const w = (lvl: string) => (msg: string) => sink(`${new Date().toISOString()} [${lvl}] ${redact(msg, secrets)}`);
  return { info: w('INFO'), warn: w('WARN'), error: w('ERROR') };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
