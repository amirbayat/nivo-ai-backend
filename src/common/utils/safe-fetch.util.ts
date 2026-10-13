import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP } from 'net';

// 2.6 — SSRF: هر URLی که کاربر (فروشنده) می‌دهد فقط از طریق این تابع دانلود می‌شود.
// بررسی IP در لحظه‌ی اتصال (hook مربوط به lookup) انجام می‌شود، نه یک resolve جدا قبلش؛ پس
// DNS rebinding (اول IP عمومی، بعد IP داخلی) هم کار نمی‌کند. ریدایرکت‌ها دستی و با همان
// اعتبارسنجی دنبال می‌شوند، حجم پاسخ سقف دارد.

export class UnsafeUrlError extends Error {}
export class ResponseTooLargeError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + metadata ابری (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast و رزرو شده (224–255)
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

// ::ffff:127.0.0.1 و ::ffff:7f00:1 (IPv4-mapped) و 64:ff9b::/96 (NAT64) به IPv4 داخلی‌شان
// نگاشت می‌شوند؛ باید با قاعده‌ی IPv4 چک شوند
function embeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(
    /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // چیزی که IP نیست را رد کن
  if (family === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return blocked.check(v4, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return blocked.check(ip, 'ipv4');
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

export function createSafeFetch(
  isBlocked: (ip: string) => boolean = isBlockedAddress,
  allowAnyPort = false,
) {
  function validateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UnsafeUrlError('invalid url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UnsafeUrlError('protocol not allowed');
    }
    if (url.username || url.password) {
      throw new UnsafeUrlError('credentials in url');
    }
    if (!allowAnyPort && url.port && url.port !== '80' && url.port !== '443') {
      throw new UnsafeUrlError('port not allowed');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isBlocked(host)) {
      throw new UnsafeUrlError('address not allowed');
    }
    return url;
  }

  const guardedLookup = ((
    hostname: string,
    options: dns.LookupOptions,
    callback: (...args: unknown[]) => void,
  ) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((a) => isBlocked(a.address))) {
        return callback(new UnsafeUrlError('address not allowed'));
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  }) as unknown as net_LookupFn;

  function once(
    url: URL,
    opts: SafeFetchOptions,
  ): Promise<
    { redirect: string } | { status: number; contentType: string; body: Buffer }
  > {
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        url,
        {
          method: 'GET',
          headers: opts.headers,
          lookup: guardedLookup,
          timeout: opts.timeoutMs ?? 10_000,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          if (status >= 300 && status < 400 && location) {
            res.resume();
            resolve({ redirect: location });
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          let failed = false;
          res.on('data', (chunk: Buffer) => {
            if (failed) return;
            total += chunk.length;
            if (total > opts.maxBytes) {
              failed = true;
              const err = new ResponseTooLargeError('response too large');
              reject(err);
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (failed) return;
            resolve({
              status,
              contentType: String(res.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks),
            });
          });
          res.on('error', (err) => {
            if (!failed) reject(err);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  return async function safeFetch(
    rawUrl: string,
    opts: SafeFetchOptions,
  ): Promise<SafeFetchResult> {
    let current = validateUrl(rawUrl);
    const maxRedirects = opts.maxRedirects ?? 3;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const out = await once(current, opts);
      if ('redirect' in out) {
        current = validateUrl(new URL(out.redirect, current).toString());
        continue;
      }
      return { ...out, finalUrl: current.toString() };
    }
    throw new UnsafeUrlError('too many redirects');
  };
}

type net_LookupFn = typeof dns.lookup;

export const safeFetch = createSafeFetch();
