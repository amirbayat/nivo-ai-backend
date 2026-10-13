import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  UnsafeUrlError,
  ResponseTooLargeError,
  createSafeFetch,
  isBlockedAddress,
  safeFetch,
} from './safe-fetch.util';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    'not-an-ip',
  ])('%s مسدود است', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '93.184.216.34',
    '2606:4700::1111',
  ])('%s مجاز است', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('safeFetch — ورودی‌های ممنوع', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://user:pass@example.com/',
    'http://example.com:8080/',
    'http://10.0.0.5:80/',
    'not a url',
  ])('%s رد می‌شود', async (url) => {
    await expect(safeFetch(url, { maxBytes: 1000 })).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it('localhost در لحظه‌ی اتصال (DNS) رد می‌شود', async () => {
    await expect(
      safeFetch('http://localhost/', { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe('safeFetch — رفتار با سرور آزمایشی (فیلتر IP خاموش)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/ok' });
        return res.end();
      }
      if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        return res.end();
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(Buffer.alloc(5000));
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('hello'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const open = createSafeFetch(() => false, true);

  it('پاسخ عادی و ریدایرکت را دنبال می‌کند', async () => {
    const r = await open(`${base}/redirect`, { maxBytes: 100 });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('hello');
    expect(r.contentType).toBe('image/png');
  });

  it('پاسخ بزرگ‌تر از سقف رد می‌شود', async () => {
    await expect(
      open(`${base}/big`, { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('حلقه‌ی ریدایرکت متوقف می‌شود', async () => {
    await expect(
      open(`${base}/loop`, { maxBytes: 100 }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('ریدایرکت به آدرس داخلی در حالت پیش‌فرض رد می‌شود', async () => {
    const guarded = createSafeFetch(isBlockedAddress, true);
    await expect(
      guarded(`${base}/redirect`, { maxBytes: 100 }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
