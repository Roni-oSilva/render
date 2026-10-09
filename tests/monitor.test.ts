import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/database/memory';
import { runMonitor, isDue } from '../src/monitor/run';
import { runWatchdog, evaluateHealth } from '../src/monitor/watchdog';
import { applyOutcome } from '../src/services/incidents';
import { buildChannels, discordChannel, dispatchAlert } from '../src/alerts/channels';
import { createLogger, redact } from '../src/shared/logger';
import { toCsv } from '../src/shared/csv';
import { validateServiceInput } from '../src/shared/validation';
import { localLookup, makeService, recorder, repoWith, silentLog, startServer } from './helpers';
import type { AttemptResult } from '../src/monitor/http';

const bad: AttemptResult = { result: 'down', statusCode: 500, latencyMs: 50, errorKind: 'unexpected_status', errorMessage: 'HTTP 500', transient: false };
const good: AttemptResult = { result: 'up', statusCode: 200, latencyMs: 50, errorKind: null, errorMessage: null, transient: false };
const at = (m: number) => new Date(Date.UTC(2025, 0, 1, 12, m)).toISOString();

describe('incidentes e alertas', () => {
  it('abre incidente só ao atingir o limite, sem alertas duplicados, e alerta recuperação', async () => {
    const svc = makeService({ failure_threshold: 3 });
    const repo = repoWith(svc);
    const ch = recorder();
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(0), final: bad, slow: false });
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(5), final: bad, slow: false });
    expect(repo.incidents).toHaveLength(0);
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(10), final: bad, slow: false });
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(15), final: bad, slow: false });
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(20), final: bad, slow: false });
    expect(repo.incidents).toHaveLength(1);
    expect(ch.events.filter((e) => e.type === 'down')).toHaveLength(1);
    expect(repo.incidents[0]!.open_alert_sent).toBe(true);
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(25), final: good, slow: false });
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(30), final: good, slow: false });
    expect(ch.events.filter((e) => e.type === 'recovered')).toHaveLength(1);
    expect(ch.events.at(-1)!.durationMinutes).toBe(25 - 10);
    expect(repo.incidents[0]!.resolved_at).toBe(at(25));
    expect(svc.consecutive_failures).toBe(0);
  });
  it('resolução concorrente gera um único alerta de recuperação', async () => {
    const svc = makeService({ failure_threshold: 1 });
    const repo = repoWith(svc);
    const ch = recorder();
    await applyOutcome(repo, [ch], silentLog, svc, { at: at(0), final: bad, slow: false });
    await Promise.all([1, 2, 3].map(() => applyOutcome(repo, [ch], silentLog, { ...svc }, { at: at(5), final: good, slow: false })));
    expect(ch.events.filter((e) => e.type === 'recovered')).toHaveLength(1);
  });
  it('falha do provedor de alertas não interrompe o processamento', async () => {
    const svc = makeService({ failure_threshold: 1 });
    const repo = repoWith(svc);
    await expect(applyOutcome(repo, [recorder(true)], silentLog, svc, { at: at(0), final: bad, slow: false })).resolves.toBeUndefined();
    expect(repo.incidents).toHaveLength(1);
    expect(repo.incidents[0]!.open_alert_sent).toBe(false);
  });
  it('dispatchAlert nunca lança e usa canais saudáveis', async () => {
    const okc = recorder();
    const sent = await dispatchAlert([recorder(true), okc], { type: 'down', title: 't', message: 'm', occurredAt: at(0) }, silentLog);
    expect(sent).toBe(true);
    expect(okc.events).toHaveLength(1);
  });
  it('Discord/e-mail/webhook montam requisições corretas', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response('', { status: 204 }); }) as unknown as typeof fetch;
    const ch = buildChannels({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc', GENERIC_WEBHOOK_URL: 'https://hooks.example/x',
      RESEND_API_KEY: 're_123456789012', ALERT_EMAIL_FROM: 'a@b.c', ALERT_EMAIL_TO: 'd@e.f' }, f);
    expect(ch.map((c) => c.name)).toEqual(['discord', 'webhook', 'email']);
    await dispatchAlert(ch, { type: 'down', title: 'x', message: 'y', occurredAt: at(0) }, silentLog);
    expect(calls).toHaveLength(3);
    const ratelimited = discordChannel('https://discord.com/api/webhooks/1/abc', (async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    await expect(ratelimited.send({ type: 'down', title: 'x', message: 'y', occurredAt: at(0) }, new AbortController().signal)).rejects.toThrow('429');
  });
});

describe('execução do monitor', () => {
  const opts = { trigger: 'test', concurrency: 3, check: { unsafeAllowPrivate: true, lookup: localLookup, sleep: async () => {} } };

  it('persiste resultados, isola falhas entre serviços e registra a execução', async () => {
    const ok = await startServer((_q, r) => r.end('ok'));
    const ko = await startServer((_q, r) => { r.statusCode = 500; r.end(); });
    const a = makeService({ name: 'A', url: ok.url }), b = makeService({ name: 'B', url: ko.url, failure_threshold: 1 });
    const repo = repoWith(a, b);
    const ch = recorder();
    try {
      const s = await runMonitor(repo, [ch], silentLog, opts);
      expect(s).toMatchObject({ status: 'success', processed: 2, failedServices: 1 });
      expect(repo.checks).toHaveLength(2);
      expect(a.last_result).toBe('up');
      expect(b.last_result).toBe('down');
      expect(repo.incidents).toHaveLength(1);
      expect(ch.events.map((e) => e.type)).toEqual(['down']);
      expect(repo.runs[0]).toMatchObject({ status: 'success', services_processed: 2 });
      expect(repo.runs[0]!.duration_ms).not.toBeNull();
      expect(repo.state.lock_holder).toBeNull();
      expect(repo.state.last_heartbeat_at).not.toBeNull();
    } finally { await ok.close(); await ko.close(); }
  });
  it('erro interno em um serviço não impede os demais', async () => {
    const ok = await startServer((_q, r) => r.end('ok'));
    const a = makeService({ url: ok.url }), b = makeService({ url: ok.url });
    const repo = repoWith(a, b);
    const orig = repo.updateServiceState.bind(repo);
    repo.updateServiceState = async (id, p) => { if (id === a.id) throw new Error('boom'); return orig(id, p); };
    try {
      const s = await runMonitor(repo, [], silentLog, opts);
      expect(s).toMatchObject({ status: 'partial', processed: 1, internalFailures: 1 });
      expect(b.last_result).toBe('up');
    } finally { await ok.close(); }
  });
  it('respeita o intervalo configurado (isDue)', async () => {
    const now = Date.parse(at(0));
    expect(isDue(makeService({ last_checked_at: null }), now)).toBe(true);
    expect(isDue(makeService({ interval_minutes: 15, last_checked_at: at(-5) }), now)).toBe(false);
    expect(isDue(makeService({ interval_minutes: 15, last_checked_at: at(-14) }), now)).toBe(true);
    const ok = await startServer((_q, r) => r.end('ok'));
    const svc = makeService({ url: ok.url, interval_minutes: 30, last_checked_at: new Date().toISOString() });
    const repo = repoWith(svc);
    try {
      expect((await runMonitor(repo, [], silentLog, opts)).processed).toBe(0);
      expect((await runMonitor(repo, [], silentLog, { ...opts, force: true })).processed).toBe(1);
    } finally { await ok.close(); }
  });
  it('concorrência: segunda execução simultânea é ignorada', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = await startServer(async (_q, r) => { await gate; r.end('ok'); });
    const svc = makeService({ url: slow.url, timeout_seconds: 5 });
    const repo = repoWith(svc);
    try {
      const first = runMonitor(repo, [], silentLog, opts);
      await new Promise((r) => setTimeout(r, 150));
      const second = await runMonitor(repo, [], silentLog, opts);
      expect(second.skipped).toBe(true);
      release();
      expect((await first).status).toBe('success');
      expect(repo.checks).toHaveLength(1);
      expect((await runMonitor(repo, [], silentLog, { ...opts, force: true })).skipped).toBe(false);
    } finally { release(); await slow.close(); }
  });
  it('lease expirado pode ser retomado', async () => {
    const repo = new MemoryRepository();
    let t = 1_000_000;
    repo.now = () => t;
    expect(await repo.acquireLease('a', 60)).toBe(true);
    expect(await repo.acquireLease('b', 60)).toBe(false);
    t += 61_000;
    expect(await repo.acquireLease('b', 60)).toBe(true);
  });
  it('inserção de resultados é idempotente (mesma execução repetida)', async () => {
    const repo = new MemoryRepository();
    const row = { service_id: 's', run_id: 'r', checked_at: at(0), result: 'up' as const, slow: false, status_code: 200, latency_ms: 1,
      error_kind: null, error_message: null, attempt: 1, final: true };
    await repo.insertChecks([row]);
    await repo.insertChecks([row]);
    expect(repo.checks).toHaveLength(1);
  });
  it('falha do banco propaga erro de lease (main sai com código 1 e alerta)', async () => {
    const svc = makeService();
    const repo = repoWith(svc);
    repo.failNext = 'acquireLease';
    await expect(runMonitor(repo, [], silentLog, opts)).rejects.toThrow('falha simulada');
  });
  it('retenção remove histórico antigo', async () => {
    const repo = new MemoryRepository();
    const row = (checked_at: string) => ({ service_id: 's', run_id: null, checked_at, result: 'up' as const, slow: false, status_code: 200,
      latency_ms: 1, error_kind: null, error_message: null, attempt: 1, final: true });
    await repo.insertChecks([row(new Date(Date.now() - 40 * 86400_000).toISOString()), row(new Date().toISOString())]);
    expect(await repo.purge(30)).toBe(1);
    expect(repo.checks).toHaveLength(1);
  });
});

describe('supervisão do monitor', () => {
  it('detecta execução atrasada, ausente e saudável', () => {
    const now = Date.parse(at(60));
    expect(evaluateHealth(null, now, 20)).toBe('no_data');
    expect(evaluateHealth(at(30), now, 20)).toBe('late');
    expect(evaluateHealth(at(50), now, 20)).toBe('ok');
  });
  it('watchdog alerta uma vez e avisa na normalização', async () => {
    const repo = new MemoryRepository();
    repo.state.last_heartbeat_at = at(0);
    const ch = recorder();
    const now = () => Date.parse(at(60));
    expect(await runWatchdog(repo, [ch], silentLog, now)).toBe(false);
    expect(await runWatchdog(repo, [ch], silentLog, now)).toBe(false);
    expect(ch.events.filter((e) => e.type === 'monitor_stale')).toHaveLength(1);
    repo.state.last_heartbeat_at = at(58);
    expect(await runWatchdog(repo, [ch], silentLog, now)).toBe(true);
    expect(ch.events.at(-1)!.type).toBe('monitor_recovered');
  });
});

describe('segredos', () => {
  it('logs e erros não expõem segredos', () => {
    const lines: string[] = [];
    const secret = 'super-secret-service-key-123';
    const log = createLogger([secret], (l) => lines.push(l));
    log.error(`falha com ${secret} e https://discord.com/api/webhooks/123/TOKENXYZ e Bearer abc.def.ghi`);
    const out = lines.join('\n');
    expect(out).not.toContain(secret);
    expect(out).not.toContain('TOKENXYZ');
    expect(out).not.toContain('abc.def.ghi');
    expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij')).toBe('[REDACTED]');
  });
  it('mensagens de falha de alerta não vazam o webhook', async () => {
    const lines: string[] = [];
    const hook = 'https://discord.com/api/webhooks/999/SECRETTOKEN';
    const log = createLogger([hook], (l) => lines.push(l));
    const f = (async () => { throw new Error(`connect failed to ${hook}`); }) as unknown as typeof fetch;
    await dispatchAlert([discordChannel(hook, f)], { type: 'down', title: 't', message: 'm', occurredAt: at(0) }, log);
    expect(lines.join('')).not.toContain('SECRETTOKEN');
  });
  it('o código do painel não referencia service role', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk('src/dashboard')) expect(readFileSync(f, 'utf8').toLowerCase(), f).not.toContain('service_role');
  });
});

describe('CSV e validação', () => {
  it('exporta CSV com escape e proteção contra fórmulas', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,"y"', b: '=CMD()' }, { a: null, b: 'linha\nquebra' }]);
    expect(csv).toBe('a,b\r\n"x,""y""",\'=CMD()\r\n,"linha\nquebra"\r\n');
  });
  it('valida cadastro de serviço', () => {
    const valid = { name: ' Meu site ', url: 'https://example.com', interval_minutes: 5, timeout_seconds: 10, expected_status: '200-299, 301',
      max_attempts: 2, failure_threshold: 3, max_redirects: 5, active: true };
    const r = validateServiceInput(valid);
    expect(r.ok && r.value.name).toBe('Meu site');
    expect(validateServiceInput({ ...valid, url: 'http://localhost' }).ok).toBe(false);
    expect(validateServiceInput({ ...valid, interval_minutes: 7 }).ok).toBe(false);
    expect(validateServiceInput({ ...valid, expected_status: 'abc' }).ok).toBe(false);
  });
});
