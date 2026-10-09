import { randomUUID } from 'node:crypto';
import type { Repository } from '../database/repository';
import type { AlertChannel } from '../alerts/channels';
import { dispatchAlert } from '../alerts/channels';
import { errMsg, type Logger } from '../shared/logger';
import type { CheckRow, Service } from '../shared/types';
import { applyOutcome } from '../services/incidents';
import { checkWithRetries, type RetryDeps } from './http';

export interface RunOptions {
  trigger: string;
  concurrency: number;
  /** Ignora o intervalo e verifica (manual). */
  force?: boolean;
  onlyServiceId?: string;
  leaseSeconds?: number;
  now?: () => number;
  check?: RetryDeps;
  heartbeatUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface RunSummary {
  skipped: boolean;
  runId?: string;
  processed: number;
  failedServices: number;
  internalFailures: number;
  status: 'success' | 'partial' | 'failed' | 'skipped';
}

const GRACE_MS = 90_000; // tolerância de atraso do cron do GitHub

export function isDue(s: Service, nowMs: number): boolean {
  if (!s.last_checked_at) return true;
  return nowMs - Date.parse(s.last_checked_at) >= s.interval_minutes * 60_000 - GRACE_MS;
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

async function ping(url: string | undefined, suffix: string, f: typeof fetch, log: Logger) {
  if (!url) return;
  try {
    await f(url.replace(/\/+$/, '') + suffix, { signal: AbortSignal.timeout(8000) });
  } catch (e) { log.warn(`Heartbeat externo falhou: ${errMsg(e)}`); }
}

export async function runMonitor(repo: Repository, channels: AlertChannel[], log: Logger, opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? Date.now;
  const holder = `${opts.trigger}-${randomUUID()}`;
  const f = opts.fetchImpl ?? fetch;

  if (!(await repo.acquireLease(holder, opts.leaseSeconds ?? 600))) {
    log.warn('Outra execução está em andamento; esta será ignorada.');
    return { skipped: true, processed: 0, failedServices: 0, internalFailures: 0, status: 'skipped' };
  }
  const startedMs = now();
  let runId = '';
  let processed = 0, failedServices = 0, internal = 0;
  try {
    runId = await repo.createRun(opts.trigger);
    const settings = await repo.getSettings();
    let services = await repo.listActiveServices();
    if (opts.onlyServiceId) services = services.filter((s) => s.id === opts.onlyServiceId);
    const due = opts.force || opts.onlyServiceId ? services : services.filter((s) => isDue(s, startedMs));
    log.info(`Execução ${runId}: ${due.length}/${services.length} serviço(s) a verificar`);

    await pool(due, opts.concurrency, async (svc) => {
      try {
        const attempts = await checkWithRetries(
          { url: svc.url, timeoutMs: svc.timeout_seconds * 1000, maxRedirects: svc.max_redirects, expectedStatus: svc.expected_status, keyword: svc.keyword },
          svc.max_attempts, opts.check,
        );
        const at = new Date(now()).toISOString();
        const rows: CheckRow[] = attempts.map((a, idx) => ({
          service_id: svc.id, run_id: runId, checked_at: at, result: a.result,
          slow: a.result === 'up' && a.latencyMs > settings.slow_threshold_ms,
          status_code: a.statusCode, latency_ms: a.latencyMs, error_kind: a.errorKind, error_message: a.errorMessage,
          attempt: idx + 1, final: idx === attempts.length - 1,
        }));
        await repo.insertChecks(rows);
        const last = attempts.at(-1)!;
        await applyOutcome(repo, channels, log, svc, { at, final: last, slow: rows.at(-1)!.slow });
        processed++;
        if (last.result !== 'up') failedServices++;
      } catch (e) {
        internal++;
        log.error(`Falha interna ao processar "${svc.name}": ${errMsg(e)}`);
      }
    });

    try { await repo.purge(settings.retention_days); } catch (e) { internal++; log.error(`Retenção falhou: ${errMsg(e)}`); }

    const status = internal === 0 ? 'success' : processed > 0 ? 'partial' : 'failed';
    await repo.updateRun(runId, {
      finished_at: new Date(now()).toISOString(), status, services_processed: processed, services_failed: failedServices,
      internal_failures: internal, duration_ms: now() - startedMs,
    });
    log.info(`Concluída: ${processed} processados, ${failedServices} com falha, ${internal} erros internos`);
    await ping(opts.heartbeatUrl, status === 'failed' ? '/fail' : '', f, log);
    return { skipped: false, runId, processed, failedServices, internalFailures: internal, status };
  } catch (e) {
    log.error(`Execução abortada: ${errMsg(e)}`);
    if (runId) {
      try {
        await repo.updateRun(runId, { finished_at: new Date(now()).toISOString(), status: 'failed', internal_failures: internal + 1,
          duration_ms: now() - startedMs, error: errMsg(e).slice(0, 500) });
      } catch { /* banco indisponível */ }
    }
    await dispatchAlert(channels, { type: 'monitor_failed', title: '⚠️ Falha no Render Guardian',
      message: `A execução do monitor falhou: ${errMsg(e)}`, occurredAt: new Date(now()).toISOString() }, log);
    await ping(opts.heartbeatUrl, '/fail', f, log);
    return { skipped: false, runId, processed, failedServices, internalFailures: internal + 1, status: 'failed' };
  } finally {
    try { await repo.releaseLease(holder); } catch (e) { log.warn(`Não foi possível liberar o lease: ${errMsg(e)}`); }
  }
}
