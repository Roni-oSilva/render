import { isIpLiteral, isPublicIp } from './ip';

export const ALLOWED_PORTS = [80, 443, 8080, 8443];

const BLOCKED_HOSTS = new Set([
  'localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'kubernetes.default',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home', '.corp', '.intranet'];

export type UrlCheck = { ok: true; url: URL; normalized: string } | { ok: false; reason: string };

/** Validação sintática (sem DNS): protocolo, credenciais, porta e nome de host. */
export function validateUrlSyntax(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'URL inválida' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Somente HTTP e HTTPS são permitidos' };
  if (u.username || u.password) return { ok: false, reason: 'URLs com usuário/senha não são permitidas' };
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.includes(port)) return { ok: false, reason: `Porta ${port} não permitida (use ${ALLOWED_PORTS.join(', ')})` };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'Host ausente' };
  if (isIpLiteral(host)) {
    if (!isPublicIp(host)) return { ok: false, reason: 'Endereço IP privado, reservado ou não roteável' };
  } else {
    if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
      return { ok: false, reason: 'Host interno ou local não permitido' };
    if (!host.includes('.')) return { ok: false, reason: 'Host sem domínio não permitido' };
  }
  u.hash = '';
  return { ok: true, url: u, normalized: u.toString() };
}
