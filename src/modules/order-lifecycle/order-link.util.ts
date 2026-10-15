import { createHmac, randomInt, createHash, timingSafeEqual } from 'crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import { ORDER_CODE_ALPHABET } from '../../common/utils/order-code.util';
import { ORDER_LINK_CODE_LENGTH, ORDER_LINK_TTL_DAYS } from '../../common/constants/sales-ops.constants';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';

const DAY_MS = 24 * 60 * 60 * 1000;

export function orderLinkSecret(): string | null {
  const s = process.env.ORDER_LINK_SECRET?.trim();
  return s ? s : null;
}

export function hashOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signOrderToken(orderId: string, expMs: number, secret: string): string {
  const payload = `${orderId}.${expMs}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOrderToken(
  token: string,
  secret: string,
): { orderId: string; expMs: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [orderId, expRaw, sig] = parts;
  const expMs = Number(expRaw);
  if (!orderId || !Number.isFinite(expMs) || expMs < Date.now()) return null;
  const expected = createHmac('sha256', secret)
    .update(`${orderId}.${expRaw}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { orderId, expMs };
}

export function generateShortCode(): string {
  let body = '';
  for (let i = 0; i < ORDER_LINK_CODE_LENGTH; i++) {
    body += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  }
  return body;
}

export function orderLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + ORDER_LINK_TTL_DAYS * DAY_MS);
}

export function publicOrderUrl(code: string): string {
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  return `${base}/o/${code}`;
}

// Reuse an unexpired short code, or create one. Null when the flag, secret or APP_URL is off.
export async function ensureBuyerOrderLink(
  prisma: PrismaService,
  orderId: string,
): Promise<string | null> {
  const config = await getSalesAgentGlobalConfig(prisma);
  if (!config.orderPublicLinkEnabled) return null;
  const secret = orderLinkSecret();
  if (!secret) return null;
  // R3.8 — بدون APP_URL لینک نسبی (/o/CODE) ساخته می‌شد که در پیامک/چت بی‌معناست
  if (!process.env.APP_URL?.trim()) return null;
  const now = new Date();
  const existing = await prisma.shortLink.findFirst({
    where: { orderId, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return publicOrderUrl(existing.code);
  const exp = orderLinkExpiry(now);
  const token = signOrderToken(orderId, exp.getTime(), secret);
  for (let i = 0; i < 5; i++) {
    const code = generateShortCode();
    try {
      await prisma.shortLink.create({
        data: { code, orderId, tokenHash: hashOrderToken(token), expiresAt: exp },
      });
      return publicOrderUrl(code);
    } catch {
      // unique code collision — try again
    }
  }
  return null;
}
