import type { Repository } from '../database/repository';
import type { AlertChannel } from '../alerts/channels';
import { dispatchAlert } from '../alerts/channels';
import type { Logger } from '../shared/logger';

export type MonitorHealth = 'ok' | 'late' | 'no_data';

export function evaluateHealth(lastHeartbeatIso: string | null, nowMs: number, staleMinutes: number): MonitorHealth {
  if (!lastHeartbeatIso) return 'no_data';
  return nowMs - Date.parse(lastHeartbeatIso) > staleMinutes * 60_000 ? 'late' : 'ok';
}

/** Retorna true se o monitor está saudável (ou sem dados suficientes). */
export async function runWatchdog(repo: Repository, channels: AlertChannel[], log: Logger, now: () => number = Date.now): Promise<boolean> {
  const [state, settings] = await Promise.all([repo.getMonitorState(), repo.getSettings()]);
  const health = evaluateHealth(state.last_heartbeat_at, now(), settings.stale_after_minutes);
  const at = new Date(now()).toISOString();
  if (health === 'no_data') { log.warn('Sem heartbeat registrado ainda; nada a avaliar.'); return true; }
  if (health === 'late') {
    log.error(`Monitor atrasado: último heartbeat em ${state.last_heartbeat_at}`);
    if (!settings.monitor_alerted_at) {
      await dispatchAlert(channels, { type: 'monitor_stale', title: '⚠️ Monitor sem executar',
        message: `Nenhum heartbeat desde ${state.last_heartbeat_at} (limite: ${settings.stale_after_minutes} min).`, occurredAt: at }, log);
      await repo.setMonitorAlerted(at);
    }
    return false;
  }
  if (settings.monitor_alerted_at) {
    await dispatchAlert(channels, { type: 'monitor_recovered', title: '✅ Monitor voltou a executar',
      message: 'Heartbeat normalizado.', occurredAt: at }, log);
    await repo.setMonitorAlerted(null);
  }
  return true;
}
