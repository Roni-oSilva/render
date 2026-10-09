import http from 'node:http';
import https from 'node:https';
import type { CheckResult, ErrorKind } from '../shared/types';
import { statusMatches } from '../shared/status';
import { validateUrlSyntax } from '../security/url';
import { BlockedDestinationError, resolvePublic, systemLookup, type Lookup } from '../security/resolve';

export interface CheckOptions {
  url: string;
  timeoutMs: number;
  maxRedirects: number;
  expectedStatus: string;
  keyword?: string | null;
}

export interface AttemptResult {
  result: CheckResult;
  statusCode: number | null;
  latencyMs: number;
  errorKind: ErrorKind | null;
  errorMessage: string | null;
  transient: boolean;
}

export interface CheckDeps {
  lookup?: Lookup;
  /** Somente para testes com servidores locais. Nunca exposto via configuração. */
  unsafeAllowPrivate?: boolean;
}

const MAX_BODY = 512 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class TimeoutError extends Error {}

interface Raw { status: number; location?: string; body: string }

function request(url: URL, addr: { address: string; family: number }, deadline: number, needBody: boolean): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new TimeoutError());
    const lib = url.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': 'RenderGuardian/1.0 (+uptime-monitor)', accept: '*/*', 'accept-encoding': 'identity' },
        // conecta somente no IP já validado
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)) as never,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        if (!needBody || REDIRECTS.has(status)) {
          res.destroy();
          return finish(() => resolve({ status, location, body: '' }));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= MAX_BODY) { res.destroy(); finish(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })); }
        });
        res.on('end', () => finish(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
        res.on('error', (e) => finish(() => reject(e)));
        res.on('close', () => finish(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
      },
    );
    const timer = setTimeout(() => { req.destroy(); finish(() => reject(new TimeoutError())); }, remaining);
    req.on('error', (e) => finish(() => reject(e)));
    req.end();
  });
}

function classify(e: unknown): { kind: ErrorKind; message: string; transient: boolean; result: CheckResult } {
  if (e instanceof TimeoutError) return { kind: 'timeout', message: 'Tempo limite excedido', transient: true, result: 'timeout' };
  if (e instanceof BlockedDestinationError)
    return { kind: 'blocked_destination', message: 'Destino bloqueado pela política de segurança', transient: false, result: 'config_error' };
  const code = String((e as { code?: string })?.code ?? '');
  if (code === 'ENOTFOUND') return { kind: 'dns', message: 'Falha de DNS: domínio não encontrado', transient: false, result: 'down' };
  if (code === 'EAI_AGAIN') return { kind: 'dns', message: 'Falha temporária de DNS', transient: true, result: 'down' };
  if (code === 'ECONNREFUSED') return { kind: 'connection_refused', message: 'Conexão recusada', transient: true, result: 'down' };
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED')
    return { kind: 'connection_reset', message: 'Conexão interrompida', transient: true, result: 'down' };
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    return { kind: 'timeout', message: 'Host inalcançável / tempo de conexão esgotado', transient: true, result: 'timeout' };
  if (/CERT|TLS|SSL|ERR_OSSL|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH/i.test(code))
    return { kind: 'tls', message: `Erro TLS/certificado (${code})`, transient: false, result: 'down' };
  if (code.startsWith('HPE_')) return { kind: 'invalid_response', message: 'Resposta HTTP inválida', transient: false, result: 'down' };
  return { kind: 'unknown', message: `Erro de rede${code ? ` (${code})` : ''}`, transient: false, result: 'down' };
}

/** Executa UMA tentativa de verificação (sem novas tentativas). */
export async function checkOnce(opts: CheckOptions, deps: CheckDeps = {}): Promise<AttemptResult> {
  const start = Date.now();
  const deadline = start + opts.timeoutMs;
  const lookup = deps.lookup ?? systemLookup;
  const fail = (result: CheckResult, kind: ErrorKind, message: string, status: number | null, transient: boolean): AttemptResult => ({
    result, statusCode: status, latencyMs: Date.now() - start, errorKind: kind, errorMessage: message, transient,
  });

  let current = opts.url;
  try {
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      const v = validateUrlSyntax(current);
      if (!deps.unsafeAllowPrivate) {
        if (!v.ok) return fail('config_error', 'blocked_destination', v.reason, null, false);
      } else if (!v.ok && !/privado|interno|local|Host sem domínio|Porta/i.test(v.reason)) {
        return fail('config_error', 'invalid_url', v.reason, null, false);
      }
      const url = v.ok ? v.url : new URL(current);
      const addr = deps.unsafeAllowPrivate
        ? (await lookup(url.hostname.replace(/^\[|\]$/g, '')))[0]!
        : await resolvePublic(url.hostname, lookup);
      const needBody = !!opts.keyword;
      const raw = await request(url, addr, deadline, needBody);

      if (REDIRECTS.has(raw.status) && raw.location && !statusMatches(opts.expectedStatus, raw.status)) {
        if (hop === opts.maxRedirects) return fail('down', 'too_many_redirects', 'Limite de redirecionamentos excedido', raw.status, false);
        try { current = new URL(raw.location, url).toString(); } catch {
          return fail('down', 'invalid_response', 'Cabeçalho Location inválido', raw.status, false);
        }
        continue;
      }
      const latency = Date.now() - start;
      if (!statusMatches(opts.expectedStatus, raw.status)) {
        const transient = raw.status >= 500 && raw.status <= 504 || raw.status === 429;
        return fail('down', 'unexpected_status', `HTTP ${raw.status} fora do critério (${opts.expectedStatus})`, raw.status, transient);
      }
      if (opts.keyword && !raw.body.includes(opts.keyword)) {
        return fail('down', 'keyword_missing', 'Palavra-chave esperada não encontrada na resposta', raw.status, false);
      }
      return { result: 'up', statusCode: raw.status, latencyMs: latency, errorKind: null, errorMessage: null, transient: false };
    }
    return fail('down', 'too_many_redirects', 'Limite de redirecionamentos excedido', null, false);
  } catch (e) {
    const c = classify(e);
    return fail(c.result, c.kind, c.message, null, c.transient);
  }
}

export interface RetryDeps extends CheckDeps {
  sleep?: (ms: number) => Promise<void>;
  /** Atraso base do backoff progressivo (1s, 2s, 4s…), limitado a 10s. */
  baseDelayMs?: number;
}

/** Tentativas com backoff progressivo; só repete falhas transitórias. */
export async function checkWithRetries(opts: CheckOptions, maxAttempts: number, deps: RetryDeps = {}): Promise<AttemptResult[]> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = deps.baseDelayMs ?? 1000;
  const attempts: AttemptResult[] = [];
  for (let n = 1; n <= maxAttempts; n++) {
    const r = await checkOnce(opts, deps);
    attempts.push(r);
    if (r.result === 'up' || !r.transient || n === maxAttempts) break;
    await sleep(Math.min(base * 2 ** (n - 1), 10_000));
  }
  return attempts;
}
