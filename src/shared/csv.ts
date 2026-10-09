function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // evita injeção de fórmulas em planilhas
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(cell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(','));
  return lines.join('\r\n') + '\r\n';
}
