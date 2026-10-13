import * as crypto from 'crypto';

// PRD-nivo-sales-unified.md تسک 0.1 — فرمت signed_request متا: `<sig>.<payload>`، هر دو
// base64url؛ sig = HMAC-SHA256(payload_base64url, appSecret). فقط payload تاییدشده معتبر است.
export function parseSignedRequest(
  signedRequest: unknown,
  appSecret: string | undefined,
): { user_id?: string } | null {
  if (!appSecret || typeof signedRequest !== 'string') return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigB64, payloadB64] = parts;
  try {
    const sig = Buffer.from(sigB64, 'base64url');
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(payloadB64)
      .digest();
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(sig, expected)) return null;
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as { user_id?: unknown; algorithm?: unknown };
    if (payload.algorithm && payload.algorithm !== 'HMAC-SHA256') return null;
    if (
      typeof payload.user_id !== 'string' &&
      typeof payload.user_id !== 'number'
    )
      return null;
    return { user_id: String(payload.user_id) };
  } catch {
    return null;
  }
}
