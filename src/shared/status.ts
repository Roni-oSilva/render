/** Interpreta especificações como "200-299,301,404". */
export function parseStatusSpec(spec: string): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 100 || b > 599 || a > b) return null;
    out.push([a, b]);
  }
  return out.length ? out : null;
}

export function statusMatches(spec: string, code: number): boolean {
  const ranges = parseStatusSpec(spec);
  return !!ranges && ranges.some(([a, b]) => code >= a && code <= b);
}
