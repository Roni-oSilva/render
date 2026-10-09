import dns from 'node:dns';
import { isIpLiteral, isPublicIp } from './ip';

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type Lookup = (host: string) => Promise<ResolvedAddress[]>;

export class BlockedDestinationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BlockedDestinationError'; }
}

export const systemLookup: Lookup = async (host) => {
  const r = await dns.promises.lookup(host, { all: true, verbatim: true });
  return r.map((x) => ({ address: x.address, family: x.family as 4 | 6 }));
};

/**
 * Resolve o host e exige que TODOS os IPs sejam públicos. O primeiro endereço
 * validado é fixado (pinned) para a conexão, impedindo DNS rebinding.
 */
export async function resolvePublic(host: string, lookup: Lookup = systemLookup): Promise<ResolvedAddress> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIpLiteral(bare)) {
    if (!isPublicIp(bare)) throw new BlockedDestinationError('IP de destino não permitido');
    return { address: bare, family: bare.includes(':') ? 6 : 4 };
  }
  const addrs = await lookup(bare);
  if (!addrs.length) throw Object.assign(new Error('sem endereços'), { code: 'ENOTFOUND' });
  if (addrs.some((a) => !isPublicIp(a.address))) throw new BlockedDestinationError('Host resolve para endereço não permitido');
  return addrs[0]!;
}
