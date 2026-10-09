import type { Repository } from '../database/repository';
import type { AlertChannel } from '../alerts/channels';
import { dispatchAlert } from '../alerts/channels';
import type { Logger } from '../shared/logger';
import type { Service } from '../shared/types';
import type { AttemptResult } from '../monitor/http';

export interface Outcome {
  at: string;
  final: AttemptResult;
  slow: boolean;
}

/**
 * Atualiza o estado do serviço e gerencia incidentes/alertas.
 * Idempotência: openIncident/resolveIncident são atômicos; o alerta só é emitido
 * por quem de fato criou/encerrou o incidente.
 */
export async function applyOutcome(repo: Repository, channels: AlertChannel[], log: Logger, svc: Service, o: Outcome): Promise<void> {
  const ok = o.final.result === 'up';
  const failures = ok ? 0 : svc.consecutive_failures + 1;
  const patch = {
    consecutive_failures: failures,
    last_result: o.final.result,
    last_slow: ok && o.slow,
    last_latency_ms: o.final.latencyMs,
    last_status_code: o.final.statusCode,
    last_error: o.final.errorMessage,
    last_checked_at: o.at,
  };
  await repo.updateServiceState(svc.id, patch);
  Object.assign(svc, patch);

  if (ok) {
    const inc = await repo.getOpenIncident(svc.id);
    if (!inc) return;
    if (await repo.resolveIncident(inc.id, o.at)) {
      const minutes = Math.max(0, Math.round((Date.parse(o.at) - Date.parse(inc.first_failure_at)) / 60000));
      const sent = await dispatchAlert(channels, {
        type: 'recovered', title: `✅ ${svc.name} recuperado`, serviceName: svc.name, url: svc.url, occurredAt: o.at,
        durationMinutes: minutes, message: `${svc.name} voltou a responder. Duração estimada da indisponibilidade: ${minutes} min.`,
      }, log);
      if (sent) await repo.markIncidentAlert(inc.id, 'recovery');
    }
    return;
  }

  if (failures < svc.failure_threshold) return;
  const { incident, created } = await repo.openIncident(svc.id, o.at, o.final.errorMessage);
  await repo.updateServiceState(svc.id, { last_incident_at: incident.opened_at });
  if (!created) {
    await repo.updateIncidentError(incident.id, o.final.errorMessage);
    return;
  }
  const sent = await dispatchAlert(channels, {
    type: 'down', title: `🔴 ${svc.name} indisponível`, serviceName: svc.name, url: svc.url, occurredAt: o.at,
    message: `${svc.name} falhou ${failures}x consecutivas. Motivo: ${o.final.errorMessage ?? 'desconhecido'}.`,
  }, log);
  if (sent) await repo.markIncidentAlert(incident.id, 'open');
}
