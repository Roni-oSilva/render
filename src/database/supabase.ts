import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CheckRow, Incident, MonitorRun, MonitorState, Service, Settings } from '../shared/types';
import type { Repository, RunPatch, ServiceStatePatch } from './repository';

function fail(ctx: string, error: { message: string } | null): void {
  if (error) throw new Error(`Banco de dados (${ctx}): ${error.message}`);
}

export class SupabaseRepository implements Repository {
  private db: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async acquireLease(holder: string, ttlSeconds: number) {
    const { data, error } = await this.db.rpc('acquire_lease', { p_holder: holder, p_ttl_seconds: ttlSeconds });
    fail('acquire_lease', error);
    return data === true;
  }
  async releaseLease(holder: string) {
    const { error } = await this.db.rpc('release_lease', { p_holder: holder });
    fail('release_lease', error);
  }
  async getSettings() {
    const { data, error } = await this.db.from('settings').select('*').eq('id', 1).single();
    fail('settings', error);
    return data as Settings;
  }
  async listActiveServices() {
    const { data, error } = await this.db.from('services').select('*').eq('active', true).order('created_at');
    fail('services', error);
    return (data ?? []) as Service[];
  }
  async createRun(trigger: string) {
    const { data, error } = await this.db.from('monitor_runs').insert({ trigger }).select('id').single();
    fail('create_run', error);
    return (data as { id: string }).id;
  }
  async updateRun(id: string, patch: RunPatch) {
    const { error } = await this.db.from('monitor_runs').update(patch).eq('id', id);
    fail('update_run', error);
  }
  async insertChecks(rows: CheckRow[]) {
    if (!rows.length) return;
    // upsert + ignoreDuplicates => idempotente se a execução for repetida
    const { error } = await this.db.from('check_results').upsert(rows, { onConflict: 'run_id,service_id,attempt', ignoreDuplicates: true });
    fail('insert_checks', error);
  }
  async updateServiceState(id: string, patch: ServiceStatePatch) {
    const { error } = await this.db.from('services').update(patch).eq('id', id);
    fail('update_service', error);
  }
  async getOpenIncident(serviceId: string) {
    const { data, error } = await this.db.from('incidents').select('*').eq('service_id', serviceId).is('resolved_at', null).maybeSingle();
    fail('get_incident', error);
    return (data as Incident | null) ?? null;
  }
  async openIncident(serviceId: string, firstFailureAt: string, err: string | null) {
    const ins = await this.db.from('incidents')
      .insert({ service_id: serviceId, first_failure_at: firstFailureAt, last_error: err }).select('*').single();
    if (!ins.error) return { incident: ins.data as Incident, created: true };
    if (ins.error.code !== '23505') fail('open_incident', ins.error);
    const existing = await this.getOpenIncident(serviceId);
    if (!existing) throw new Error('Banco de dados (open_incident): conflito sem incidente aberto');
    return { incident: existing, created: false };
  }
  async resolveIncident(id: string, resolvedAt: string) {
    const { data, error } = await this.db.from('incidents').update({ resolved_at: resolvedAt }).eq('id', id).is('resolved_at', null).select('id');
    fail('resolve_incident', error);
    return (data?.length ?? 0) > 0;
  }
  async markIncidentAlert(id: string, kind: 'open' | 'recovery') {
    const col = kind === 'open' ? 'open_alert_sent' : 'recovery_alert_sent';
    const { error } = await this.db.from('incidents').update({ [col]: true }).eq('id', id);
    fail('mark_alert', error);
  }
  async updateIncidentError(id: string, e: string | null) {
    const { error } = await this.db.from('incidents').update({ last_error: e }).eq('id', id);
    fail('incident_error', error);
  }
  async purge(days: number) {
    const { data, error } = await this.db.rpc('purge_old_checks', { p_days: days });
    fail('purge', error);
    return Number(data ?? 0);
  }
  async getMonitorState() {
    const { data, error } = await this.db.from('monitor_state').select('*').eq('id', 1).single();
    fail('monitor_state', error);
    return data as MonitorState;
  }
  async getLastRun() {
    const { data, error } = await this.db.from('monitor_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle();
    fail('last_run', error);
    return (data as MonitorRun | null) ?? null;
  }
  async setMonitorAlerted(ts: string | null) {
    const { error } = await this.db.from('settings').update({ monitor_alerted_at: ts }).eq('id', 1);
    fail('monitor_alerted', error);
  }
}
