import { randomUUID } from 'crypto';
import { aceRuntime } from '../ace-runtime';

// ACE-12 — نمونه‌ی shadow: لایه جواب کاندید ساخته ولی جواب واقعی از LLM رفته.
// ذخیره در Redis (بدون SQL جدید): ace:shadow:s:{id} (JSON، ۳۰ روز) + فهرست ace:shadow:ids (۵۰۰۰ تای اخیر).
export type Verdict = 'equal' | 'worse' | 'wrong';

export interface ShadowSample {
  id: string;
  ts: number;
  layer: string; // 'fastAnswers' | 'semanticCache' | 'productBrief'
  band?: string; // برای semanticCache
  intent: string;
  storeId?: string;
  storeCategory?: string | null;
  conversationId?: string;
  customerMessage: string;
  realText: string;
  candidateText: string;
  // برای نمونه‌گیری لایه‌بندی‌شده: negated | colloquial | multi_variant | sensitive …
  tags: string[];
  judge?: { verdict: Verdict; reason: string; at: number };
  human?: { verdict: Verdict; note?: string; at: number; by?: string };
}

const TTL_SEC = 30 * 24 * 3600;
const MAX_IDS = 5000;
const key = (id: string) => `ace:shadow:s:${id}`;
const IDS = 'ace:shadow:ids';

export async function pushShadow(s: Omit<ShadowSample, 'id' | 'ts'>): Promise<string | null> {
  const redis = aceRuntime().redis;
  if (!redis) return null;
  try {
    const id = randomUUID();
    const sample: ShadowSample = { ...s, id, ts: Date.now() };
    await redis.set(key(id), JSON.stringify(sample), 'EX', TTL_SEC);
    await redis.lpush(IDS, id);
    await redis.ltrim(IDS, 0, MAX_IDS - 1);
    return id;
  } catch {
    return null; // fail-open: shadow هرگز نوبت بات را نمی‌شکند
  }
}

export async function getShadow(id: string): Promise<ShadowSample | null> {
  try {
    const raw = await aceRuntime().redis?.get(key(id));
    return raw ? (JSON.parse(raw) as ShadowSample) : null;
  } catch {
    return null;
  }
}

export async function saveShadow(s: ShadowSample): Promise<void> {
  try {
    await aceRuntime().redis?.set(key(s.id), JSON.stringify(s), 'EX', TTL_SEC);
  } catch {
    /* ignore */
  }
}

export async function listShadow(limit = 1000): Promise<ShadowSample[]> {
  const redis = aceRuntime().redis;
  if (!redis) return [];
  try {
    const ids = await redis.lrange(IDS, 0, Math.max(0, limit - 1));
    const out: ShadowSample[] = [];
    for (const id of ids) {
      const s = await getShadow(id);
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}
