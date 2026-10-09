import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MemoryRepository } from '../src/database/memory';
import type { AlertChannel, AlertEvent } from '../src/alerts/channels';
import type { Service } from '../src/shared/types';
import { createLogger } from '../src/shared/logger';

export const silentLog = createLogger([], () => {});

export function makeService(over: Partial<Service> = {}): Service {
  return {
    id: crypto.randomUUID(), name: 'Site', url: 'https://example.com/', description: null, interval_minutes: 5, timeout_seconds: 2,
    expected_status: '200-299', keyword: null, max_attempts: 1, failure_threshold: 2, max_redirects: 3, active: true,
    created_at: new Date().toISOString(), consecutive_failures: 0, last_result: null, last_slow: false, last_latency_ms: null,
    last_status_code: null, last_error: null, last_checked_at: null, last_incident_at: null, ...over,
  };
}

export function recorder(fail = false): AlertChannel & { events: AlertEvent[] } {
  const events: AlertEvent[] = [];
  return { name: 'rec', events, async send(e) { if (fail) throw new Error('provedor fora do ar'); events.push(e); } };
}

export function repoWith(...s: Service[]) {
  const r = new MemoryRepository();
  r.services.push(...s);
  return r;
}

export async function startServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export const localLookup = async () => [{ address: '127.0.0.1', family: 4 as const }];
