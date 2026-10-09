/** Classificação de IPs (sem dependências de Node; usável no navegador). */

export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p : null;
}

/** Retorna 8 grupos de 16 bits. */
export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  // IPv4 embutido no final
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0]! << 8) | v4[1]!).toString(16) + ':' + ((v4[2]! << 8) | v4[3]!).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === '' ? [] : h.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 && fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(p: number[]): number {
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

function isPublicV4(p: number[]): boolean {
  const n = v4ToInt(p);
  return !V4_BLOCKED.some(([base, bits]) => {
    const b = v4ToInt(parseIPv4(base)!);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}

function isPublicV6(g: number[]): boolean {
  // IPv4 mapeado (::ffff:a.b.c.d) e compatível: avalia o IPv4 embutido
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicV4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]) && !g.slice(0, 7).every((x) => x === 0);
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicV4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]);
  }
  if ((g[0]! & 0xe000) !== 0x2000) return false; // somente 2000::/3 (unicast global)
  if (g[0] === 0x2001 && g[1]! < 0x200) return false; // 2001::/23 (Teredo, benchmark, ORCHID…)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // documentação
  if (g[0] === 0x2002) return false; // 6to4
  if (g[0] === 0x3fff && (g[1]! & 0xf000) === 0) return false; // documentação
  return true;
}

/** true somente para endereços globalmente roteáveis. Entradas inválidas => false. */
export function isPublicIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(ip);
  return v6 ? isPublicV6(v6) : false;
}

export function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host) !== null;
}
