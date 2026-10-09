import type { CheckRow, Incident, MonitorRun, MonitorState, Service, Settings } from '../shared/types';

export type ServiceStatePatch = Partial<Pick<Service,
  'consecutive_failures' | 'last_result' | 'last_slow' | 'last_latency_ms' | 'last_status_code' |
  'last_error' | 'last_checked_at' | 'last_incident_at'>>;

export type RunPatch = Partial<Pick<MonitorRun,
  'finished_at' | 'status' | 'services_processed' | 'services_failed' | 'internal_failures' | 'duration_ms' | 'error'>>;

export interface Repository {
  acquireLease(holder: string, ttlSeconds: number): Promise<boolean>;
  releaseLease(holder: string): Promise<void>;
  getSettings(): Promise<Settings>;
  listActiveServices(): Promise<Service[]>;
  createRun(trigger: string): Promise<string>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  insertChecks(rows: CheckRow[]): Promise<void>;
  updateServiceState(id: string, patch: ServiceStatePatch): Promise<void>;
  getOpenIncident(serviceId: string): Promise<Incident | null>;
  /** Atômico: cria o incidente aberto ou devolve o existente (created=false). */
  openIncident(serviceId: string, firstFailureAt: string, error: string | null): Promise<{ incident: Incident; created: boolean }>;
  /** Atômico: true somente para a chamada que de fato encerrou o incidente. */
  resolveIncident(id: string, resolvedAt: string): Promise<boolean>;
  markIncidentAlert(id: string, kind: 'open' | 'recovery'): Promise<void>;
  updateIncidentError(id: string, error: string | null): Promise<void>;
  purge(days: number): Promise<number>;
  getMonitorState(): Promise<MonitorState>;
  getLastRun(): Promise<MonitorRun | null>;
  setMonitorAlerted(ts: string | null): Promise<void>;
}
