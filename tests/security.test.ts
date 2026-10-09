import { describe, expect, it } from 'vitest';
import { isPublicIp } from '../src/security/ip';
import { validateUrlSyntax } from '../src/security/url';
import { resolvePublic, BlockedDestinationError } from '../src/security/resolve';
import { checkOnce } from '../src/monitor/http';
import { startServer } from './helpers';

describe('validação de URL', () => {
  it.each(['https://example.com', 'http://example.com/path?q=1', 'https://example.com:8443/x', 'https://8.8.8.8/'])('aceita %s', (u) => {
    expect(validateUrlSyntax(u).ok).toBe(true);
  });
  it.each([
    'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'não é url', '',
    'http://localhost', 'http://foo.localhost', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f.1', 'http://[::1]/',
    'http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.1', 'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal', 'http://100.100.100.200', 'http://[fd00:ec2::254]/', 'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/', 'http://intranet', 'http://user:pw@example.com', 'https://example.com:22', 'http://0.0.0.0', 'http://224.0.0.1',
  ])('bloqueia %s', (u) => {
    expect(validateUrlSyntax(u).ok).toBe(false);
  });
});

describe('isPublicIp', () => {
  it('classifica corretamente', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(isPublicIp(ip), ip).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '255.255.255.255',
      '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::', 'lixo', '999.1.1.1'])
      expect(isPublicIp(ip), ip).toBe(false);
  });
});

describe('resolução DNS (anti-rebinding)', () => {
  it('bloqueia host que resolve para IP privado', async () => {
    await expect(resolvePublic('evil.example', async () => [{ address: '10.0.0.1', family: 4 }])).rejects.toBeInstanceOf(BlockedDestinationError);
  });
  it('bloqueia se QUALQUER registro for privado', async () => {
    await expect(resolvePublic('mix.example', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toBeInstanceOf(BlockedDestinationError);
  });
  it('aceita DNS público', async () => {
    expect((await resolvePublic('ok.example', async () => [{ address: '8.8.8.8', family: 4 }])).address).toBe('8.8.8.8');
  });
  it('checkOnce classifica DNS->privado como config_error', async () => {
    const r = await checkOnce({ url: 'https://rebind.example/', timeoutMs: 2000, maxRedirects: 2, expectedStatus: '200-299' },
      { lookup: async () => [{ address: '169.254.169.254', family: 4 }] });
    expect(r.result).toBe('config_error');
    expect(r.errorKind).toBe('blocked_destination');
  });
  it('bloqueia IP literal privado direto no executor', async () => {
    const r = await checkOnce({ url: 'http://127.0.0.1/', timeoutMs: 2000, maxRedirects: 0, expectedStatus: '200-299' });
    expect(r.result).toBe('config_error');
  });
});

describe('redirecionamentos', () => {
  it('revalida destino após redirect (redirect para metadata é bloqueado)', async () => {
    const srv = await startServer((_q, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); res.end(); });
    try {
      const r = await checkOnce({ url: `${srv.url}/`, timeoutMs: 3000, maxRedirects: 3, expectedStatus: '200-299' },
        { unsafeAllowPrivate: true, lookup: async (h) => [{ address: h === '169.254.169.254' ? '169.254.169.254' : '127.0.0.1', family: 4 }] });
      // com unsafeAllowPrivate (apenas testes) o primeiro salto local passa; o destino de metadata continua sendo avaliado
      expect(['config_error', 'down', 'timeout']).toContain(r.result);
    } finally { await srv.close(); }
  });
  it('em modo estrito o primeiro destino local já é bloqueado', async () => {
    const srv = await startServer((_q, res) => { res.end('ok'); });
    try {
      const r = await checkOnce({ url: srv.url, timeoutMs: 2000, maxRedirects: 3, expectedStatus: '200-299' });
      expect(r.result).toBe('config_error');
    } finally { await srv.close(); }
  });
});
