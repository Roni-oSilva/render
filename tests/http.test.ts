import { describe, expect, it } from 'vitest';
import { checkOnce, checkWithRetries } from '../src/monitor/http';
import { localLookup, startServer } from './helpers';

const base = { timeoutMs: 1500, maxRedirects: 3, expectedStatus: '200-299' };
const deps = { unsafeAllowPrivate: true, lookup: localLookup };

describe('verificação HTTP', () => {
  it('sucesso 200 com latência', async () => {
    const s = await startServer((_q, r) => r.end('olá mundo'));
    try {
      const r = await checkOnce({ ...base, url: s.url }, deps);
      expect(r).toMatchObject({ result: 'up', statusCode: 200, errorKind: null });
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    } finally { await s.close(); }
  });
  it('404 e 500 são falhas; códigos configuráveis', async () => {
    const s = await startServer((q, r) => { r.statusCode = q.url === '/404' ? 404 : 500; r.end(); });
    try {
      expect((await checkOnce({ ...base, url: s.url + '/404' }, deps)).result).toBe('down');
      const r500 = await checkOnce({ ...base, url: s.url + '/500' }, deps);
      expect(r500).toMatchObject({ result: 'down', statusCode: 500, transient: true });
      expect((await checkOnce({ ...base, url: s.url + '/404', expectedStatus: '200-299,404' }, deps)).result).toBe('up');
    } finally { await s.close(); }
  });
  it('timeout', async () => {
    const s = await startServer(() => { /* nunca responde */ });
    try {
      const r = await checkOnce({ ...base, timeoutMs: 300, url: s.url }, deps);
      expect(r).toMatchObject({ result: 'timeout', errorKind: 'timeout' });
    } finally { await s.close(); }
  });
  it('falha de DNS (ENOTFOUND)', async () => {
    const r = await checkOnce({ ...base, url: 'https://naoexiste.example/' }, {
      lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); },
    });
    expect(r).toMatchObject({ result: 'down', errorKind: 'dns', transient: false });
  });
  it('conexão recusada', async () => {
    const s = await startServer((_q, r) => r.end());
    const url = s.url;
    await s.close();
    const r = await checkOnce({ ...base, url }, deps);
    expect(r).toMatchObject({ result: 'down', errorKind: 'connection_refused', transient: true });
  });
  it('palavra-chave', async () => {
    const s = await startServer((_q, r) => r.end('<h1>Bem-vindo</h1>'));
    try {
      expect((await checkOnce({ ...base, url: s.url, keyword: 'Bem-vindo' }, deps)).result).toBe('up');
      expect((await checkOnce({ ...base, url: s.url, keyword: 'ausente' }, deps)).errorKind).toBe('keyword_missing');
    } finally { await s.close(); }
  });
  it('segue redirecionamentos até o limite', async () => {
    const s = await startServer((q, r) => {
      if (q.url === '/') { r.writeHead(301, { location: '/b' }); r.end(); } else if (q.url === '/b') r.end('fim');
    });
    try {
      expect((await checkOnce({ ...base, url: s.url }, deps)).result).toBe('up');
      expect((await checkOnce({ ...base, url: s.url, maxRedirects: 0 }, deps)).result).toBe('down');
    } finally { await s.close(); }
  });
  it('resposta HTTP inválida', async () => {
    const net = await import('node:net');
    const srv = net.createServer((sock) => { sock.end('LIXO NAO HTTP\r\n\r\n'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as import('node:net').AddressInfo).port;
    try {
      const r = await checkOnce({ ...base, url: `http://127.0.0.1:${port}` }, deps);
      expect(r.result).toBe('down');
      expect(r.errorKind).toBe('invalid_response');
    } finally { srv.close(); }
  });
});

describe('novas tentativas', () => {
  it('repete erro transitório com backoff e para ao ter sucesso', async () => {
    let n = 0;
    const s = await startServer((_q, r) => { n++; r.statusCode = n < 3 ? 503 : 200; r.end(); });
    const delays: number[] = [];
    try {
      const a = await checkWithRetries({ ...base, url: s.url }, 4, { ...deps, sleep: async (ms) => { delays.push(ms); } });
      expect(a.map((x) => x.result)).toEqual(['down', 'down', 'up']);
      expect(delays).toEqual([1000, 2000]);
    } finally { await s.close(); }
  });
  it('não repete erro permanente (404) e respeita o máximo', async () => {
    let n = 0;
    const s = await startServer((_q, r) => { n++; r.statusCode = 404; r.end(); });
    try {
      const a = await checkWithRetries({ ...base, url: s.url }, 4, { ...deps, sleep: async () => {} });
      expect(a).toHaveLength(1);
      n = 0;
      const b = await checkWithRetries({ ...base, url: s.url, expectedStatus: '200' }, 4, deps);
      expect(b).toHaveLength(1);
    } finally { await s.close(); }
  });
  it('limita tentativas em falhas transitórias', async () => {
    const s = await startServer((_q, r) => { r.statusCode = 502; r.end(); });
    try {
      const a = await checkWithRetries({ ...base, url: s.url }, 3, { ...deps, sleep: async () => {} });
      expect(a).toHaveLength(3);
    } finally { await s.close(); }
  });
});
