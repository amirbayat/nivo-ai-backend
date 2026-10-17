import { createHash } from 'crypto';
import { aceParams, engineAllowsLayers, layerMode } from './ace-config';
import { aceNote } from './ace-context';
import { aceRuntime } from './ace-runtime';

export function normalizeEmbeddingText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
}

const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const decode = (s: string) => Array.from(new Float32Array(new Uint8Array(Buffer.from(s, 'base64')).buffer));

// ACE-4 — ace:emb:{model}:{sha1(normalized)}، TTL ۷ روز. خطا/خاموش → compute مستقیم.
export async function cachedEmbedding(
  model: string,
  text: string,
  compute: () => Promise<number[] | null>,
): Promise<number[] | null> {
  const redis = aceRuntime().redis;
  if (!engineAllowsLayers()) return compute();
  let on = false;
  try {
    on = (await layerMode('embedCache')) === 'on';
  } catch {
    on = false;
  }
  if (!on || !redis) return compute();
  const key = `ace:emb:${model}:${createHash('sha1').update(normalizeEmbeddingText(text)).digest('hex')}`;
  try {
    const hit = await redis.get(key);
    if (hit) {
      aceNote('embedCache', 'embedding همین متن از کش برگشت؛ فراخوانی embedding انجام نشد', 'embedding');
      return decode(hit);
    }
  } catch {
    return compute();
  }
  const value = await compute();
  if (value) {
    try {
      await redis.set(key, encode(value), 'EX', (await aceParams()).embeddingTtlSec);
    } catch {
      /* fail-open */
    }
  }
  return value;
}
