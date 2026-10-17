import { createHash } from 'crypto';
import { aceParams, engineAllowsLayers, layerMode } from './ace-config';
import { getAceContext } from './ace-context';
import { aceRuntime } from './ace-runtime';
import { recordAiCall } from './ledger-sink';
import { versionsFor } from './version-keys';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// JSON با ترتیب کلید ثابت (کلید memo نباید به ترتیب property وابسته باشد)
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const SF_WAIT_MS = 8000;
const SF_POLL_MS = 150;
const SF_LOCK_MS = 15000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MemoOptions<T> {
  callSite: string;
  // هرچه خروجی را تعیین می‌کند (مدل، پیام‌ها، schema، دما …)
  keyInput: unknown;
  sources?: { storeId?: string; kb?: boolean; productIds?: string[] };
  ttlSec?: number;
  // هزینه‌ی تخمینی یک call برای avoidedUsdMicros
  estimateCostUsdMicros?: number;
  // روی hit (memo/single-flight) اعمال می‌شود؛ مثلاً usage ذخیره‌شده را صفر کن تا دوباره bill نشود
  onHit?: (value: T) => T;
  compute: () => Promise<T>;
}

// ACE-3 — کش دقیق + single-flight. فقط برای callهای temperature=0 و بدون history.
// I-6: Redis/لایه خاموش/هر خطا → مستقیم compute (رفتار قبلی).
export async function memoCall<T>(opts: MemoOptions<T>): Promise<T> {
  const redis = aceRuntime().redis;
  if (!engineAllowsLayers()) return opts.compute();
  let mode;
  try {
    mode = await layerMode('memo');
  } catch {
    return opts.compute();
  }
  if (mode !== 'on' || !redis) return opts.compute();

  const versions = await versionsFor(opts.sources ?? {});
  if (versions === null) return opts.compute();
  const key = `ace:memo:${opts.callSite}:${sha256(`${opts.sources?.storeId ?? '-'}|${versions}|${canonicalJson(opts.keyInput)}`)}`;

  const readHit = async (): Promise<T | undefined> => {
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as { v: T }).v : undefined;
    } catch {
      return undefined;
    }
  };
  const recordHit = (servedBy: 'memo' | 'single_flight') => {
    const ctx = getAceContext();
    recordAiCall({
      storeId: ctx?.storeId, conversationId: ctx?.conversationId, turnId: ctx?.turnId,
      callSite: opts.callSite, servedBy, avoidedUsdMicros: opts.estimateCostUsdMicros ?? 0,
    });
  };

  const hit = await readHit();
  if (hit !== undefined) {
    recordHit('memo');
    return opts.onHit ? opts.onHit(hit) : hit;
  }

  const ttl = opts.ttlSec ?? (await aceParams()).memoTtlSec;
  const lockKey = `ace:sf:${key}`;
  let owner = false;
  try {
    owner = (await redis.set(lockKey, '1', 'PX', SF_LOCK_MS, 'NX')) === 'OK';
  } catch {
    return opts.compute();
  }
  if (!owner) {
    const until = Date.now() + SF_WAIT_MS;
    while (Date.now() < until) {
      await sleep(SF_POLL_MS);
      const v = await readHit();
      if (v !== undefined) {
        recordHit('single_flight');
        return opts.onHit ? opts.onHit(v) : v;
      }
    }
    return opts.compute(); // timeout → خودمان call می‌زنیم
  }
  try {
    const value = await opts.compute();
    try {
      await redis.set(key, JSON.stringify({ v: value }), 'EX', ttl);
    } catch {
      /* fail-open */
    }
    return value;
  } finally {
    try {
      await redis.del(lockKey);
    } catch {
      /* قفل خودش منقضی می‌شود */
    }
  }
}
