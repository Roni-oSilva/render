export type CheckResult = 'up' | 'down' | 'timeout' | 'config_error';
export type ErrorKind =
  | 'dns' | 'connection_refused' | 'connection_reset' | 'tls' | 'timeout'
  | 'invalid_response' | 'unexpected_status' | 'keyword_missing' | 'blocked_destination'
  | 'invalid_url' | 'too_many_redirects' | 'unknown';

export const INTERVALS = [5, 10, 15, 20, 25, 30] as const;

export interface Service {
  id: string;
  name: string;
  url: string;
  description: string | null;
  interval_minutes: number;
  timeout_seconds: number;
  expected_status: string;
  keyword: string | null;
  max_attempts: number;
  failure_threshold: number;
  max_redirects: number;
  active: boolean;
  created_at: string;
  consecutive_failures: number;
  last_result: CheckResult | null;
  last_slow: boolean;
  last_latency_ms: number | null;
  last_status_code: number | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_incident_at: string | null;
}

export interface CheckRow {
  id?: number;
  service_id: string;
  run_id: string | null;
  checked_at: string;
  result: CheckResult;
  slow: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error_kind: ErrorKind | null;
  error_message: string | null;
  attempt: number;
  final: boolean;
}

export interface Incident {
  id: string;
  service_id: string;
  opened_at: string;
  first_failure_at: string;
  resolved_at: string | null;
  last_error: string | null;
  open_alert_sent: boolean;
  recovery_alert_sent: boolean;
}

export interface Settings {
  retention_days: number;
  slow_threshold_ms: number;
  stale_after_minutes: number;
  monitor_alerted_at: string | null;
}

export interface MonitorRun {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  services_processed: number;
  services_failed: number;
  internal_failures: number;
  duration_ms: number | null;
  error: string | null;
}

export interface MonitorState {
  lock_holder: string | null;
  lock_expires_at: string | null;
  last_heartbeat_at: string | null;
}
