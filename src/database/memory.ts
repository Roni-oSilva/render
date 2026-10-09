import { randomUUID } from 'node:crypto';
import type { CheckRow, Incident, MonitorRun, MonitorState, Service, Settings } from '../shared/types';
import type { Repository, RunPatch, ServiceStatePatch } from './repository';

/** Implementação em memória com a mesma semântica atômica do Postgres (para testes). */
export class MemoryRepository implements Repository {
  services: Service[] = [];
  checks: CheckRow[] = [];
  incidents: Incident[] = [];
  runs: MonitorRun[] = [];
  settings: Settings = { retention_days: 30, slow_threshold_ms: 3000, stale_after_minutes: 20, monitor_alerted_at: null };
  state: MonitorState = { lock_holder: null, lock_expires_at: null, last_heartbeat_at: null };
  now: () => number = () => Date.now();
  failNext: string | null = null;

  private maybeFail(op: string) {
    if (this.failNext === op) { this.failNext = null; throw new Error(`falha simulada: ${op}`); }
  }

  async acquireLease(holder: string, ttl: number) {
    this.maybeFail('acquireLease');
    const exp = this.state.lock_expires_at ? Date.parse(this.state.lock_expires_at) : 0;
    if (this.state.lock_holder && exp >= this.now() && this.state.lock_holder !== holder) return false;
    this.state = { lock_holder: holder, lock_expires_at: new Date(this.now() + ttl * 1000).toISOString(), last_heartbeat_at: new Date(this.now()).toISOString() };
    return true;
  }
  async releaseLease(holder: string) {
    if (this.state.lock_holder === holder) this.state = { lock_holder: null, lock_expires_at: null, last_heartbeat_at: new Date(this.now()).toISOString() };
  }
  async getSettings() { return this.settings; }
  async listActiveServices() { return this.services.filter((s) => s.active); }
  async createRun(trigger: string) {
    const r: MonitorRun = { id: randomUUID(), trigger, started_at: new Date(this.now()).toISOString(), finished_at: null, status: 'running',
      services_processed: 0, services_failed: 0, internal_failures: 0, duration_ms: null, error: null };
    this.runs.push(r);
    return r.id;
  }
  async updateRun(id: string, patch: RunPatch) { Object.assign(this.runs.find((r) => r.id === id)!, patch); }
  async insertChecks(rows: CheckRow[]) {
    this.maybeFail('insertChecks');
    for (const r of rows) {
      if (r.run_id !== null && this.checks.some((c) => c.run_id === r.run_id && c.service_id === r.service_id && c.attempt === r.attempt)) continue;
      this.checks.push({ ...r, id: this.checks.length + 1 });
    }
  }
  async updateServiceState(id: string, patch: ServiceStatePatch) { Object.assign(this.services.find((s) => s.id === id)!, patch); }
  async getOpenIncident(serviceId: string) { return this.incidents.find((i) => i.service_id === serviceId && !i.resolved_at) ?? null; }
  async openIncident(serviceId: string, first: string, error: string | null) {
    const ex = await this.getOpenIncident(serviceId);
    if (ex) return { incident: ex, created: false };
    const inc: Incident = { id: randomUUID(), service_id: serviceId, opened_at: new Date(this.now()).toISOString(), first_failure_at: first,
      resolved_at: null, last_error: error, open_alert_sent: false, recovery_alert_sent: false };
    this.incidents.push(inc);
    return { incident: inc, created: true };
  }
  async resolveIncident(id: string, at: string) {
    const i = this.incidents.find((x) => x.id === id);
    if (!i || i.resolved_at) return false;
    i.resolved_at = at;
    return true;
  }
  async markIncidentAlert(id: string, kind: 'open' | 'recovery') {
    const i = this.incidents.find((x) => x.id === id)!;
    if (kind === 'open') i.open_alert_sent = true; else i.recovery_alert_sent = true;
  }
  async updateIncidentError(id: string, e: string | null) { this.incidents.find((x) => x.id === id)!.last_error = e; }
  async purge(days: number) {
    const cutoff = this.now() - days * 86400_000;
    const before = this.checks.length;
    this.checks = this.checks.filter((c) => Date.parse(c.checked_at) >= cutoff);
    return before - this.checks.length;
  }
  async getMonitorState() { return this.state; }
  async getLastRun() { return this.runs.at(-1) ?? null; }
  async setMonitorAlerted(ts: string | null) { this.settings.monitor_alerted_at = ts; }
}
