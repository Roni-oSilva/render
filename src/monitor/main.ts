import { SupabaseRepository } from '../database/supabase';
import { buildChannels, dispatchAlert } from '../alerts/channels';
import { createLogger, errMsg } from '../shared/logger';
import { runMonitor } from './run';
import { runWatchdog } from './watchdog';

const env = process.env;
const log = createLogger([
  env.SUPABASE_SERVICE_ROLE_KEY, env.DISCORD_WEBHOOK_URL, env.GENERIC_WEBHOOK_URL, env.RESEND_API_KEY, env.HEARTBEAT_URL,
]);

async function main() {
  const cmd = process.argv[2] ?? 'run';
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    log.error('Configuração ausente: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    return 2;
  }
  const repo = new SupabaseRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const channels = buildChannels(env);
  if (cmd === 'watchdog') return (await runWatchdog(repo, channels, log)) ? 0 : 1;

  const only = env.ONLY_SERVICE_ID?.trim() || undefined;
  const conc = Number(env.MAX_CONCURRENCY) || 5;
  const s = await runMonitor(repo, channels, log, {
    trigger: env.MONITOR_TRIGGER || 'schedule', concurrency: Math.min(Math.max(conc, 1), 10),
    force: env.FORCE_ALL === 'true', onlyServiceId: only, heartbeatUrl: env.HEARTBEAT_URL,
  });
  return s.status === 'failed' ? 1 : 0;
}

main().then((c) => process.exit(c)).catch(async (e) => {
  log.error(`Erro fatal (banco/autenticação/configuração): ${errMsg(e)}`);
  await dispatchAlert(buildChannels(env), { type: 'monitor_failed', title: '⚠️ Falha no Render Guardian',
    message: `Erro fatal: ${errMsg(e).slice(0, 300)}`, occurredAt: new Date().toISOString() }, log);
  process.exit(1);
});
