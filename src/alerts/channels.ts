import type { Logger } from '../shared/logger';
import { errMsg } from '../shared/logger';

export interface AlertEvent {
  type: 'down' | 'recovered' | 'monitor_stale' | 'monitor_failed' | 'monitor_recovered';
  title: string;
  message: string;
  serviceName?: string;
  url?: string;
  occurredAt: string;
  durationMinutes?: number;
}

export interface AlertChannel {
  name: string;
  send(event: AlertEvent, signal: AbortSignal): Promise<void>;
}

type Fetch = typeof fetch;
const COLORS: Record<AlertEvent['type'], number> = {
  down: 0xdc2626, recovered: 0x16a34a, monitor_stale: 0xea580c, monitor_failed: 0xdc2626, monitor_recovered: 0x16a34a,
};

export const brt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function discordChannel(webhook: string, f: Fetch = fetch): AlertChannel {
  return {
    name: 'discord',
    async send(e, signal) {
      const res = await f(webhook, {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Render Guardian', embeds: [{
          title: e.title, description: e.message, color: COLORS[e.type], timestamp: e.occurredAt,
          fields: [
            ...(e.url ? [{ name: 'URL', value: e.url }] : []),
            ...(e.durationMinutes !== undefined ? [{ name: 'Duração estimada', value: `${e.durationMinutes} min` }] : []),
            { name: 'Horário (Brasília)', value: brt(e.occurredAt) },
          ] }] }),
      });
      if (!res.ok) throw new Error(`Discord respondeu HTTP ${res.status}`);
    },
  };
}

export function webhookChannel(url: string, f: Fetch = fetch): AlertChannel {
  return {
    name: 'webhook',
    async send(e, signal) {
      const res = await f(url, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
      if (!res.ok) throw new Error(`Webhook respondeu HTTP ${res.status}`);
    },
  };
}

export function emailChannel(apiKey: string, from: string, to: string, f: Fetch = fetch): AlertChannel {
  return {
    name: 'email',
    async send(e, signal) {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from, to: [to], subject: e.title,
          text: `${e.message}\n\n${e.url ?? ''}\nHorário (Brasília): ${brt(e.occurredAt)}` }),
      });
      if (!res.ok) throw new Error(`E-mail respondeu HTTP ${res.status}`);
    },
  };
}

export function buildChannels(env: Record<string, string | undefined>, f: Fetch = fetch): AlertChannel[] {
  const out: AlertChannel[] = [];
  if (env.DISCORD_WEBHOOK_URL) out.push(discordChannel(env.DISCORD_WEBHOOK_URL, f));
  if (env.GENERIC_WEBHOOK_URL) out.push(webhookChannel(env.GENERIC_WEBHOOK_URL, f));
  if (env.RESEND_API_KEY && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO)
    out.push(emailChannel(env.RESEND_API_KEY, env.ALERT_EMAIL_FROM, env.ALERT_EMAIL_TO, f));
  return out;
}

/** Envia para todos os canais; nunca lança. Retorna true se ao menos um entregou. */
export async function dispatchAlert(channels: AlertChannel[], event: AlertEvent, log: Logger, timeoutMs = 10_000): Promise<boolean> {
  if (!channels.length) { log.warn(`Nenhum canal de alerta configurado (${event.type})`); return false; }
  const results = await Promise.allSettled(channels.map(async (c) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { await c.send(event, ctl.signal); } finally { clearTimeout(t); }
  }));
  let ok = false;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok = true;
    else log.error(`Falha ao enviar alerta via ${channels[i]!.name}: ${errMsg(r.reason)}`);
  });
  return ok;
}
