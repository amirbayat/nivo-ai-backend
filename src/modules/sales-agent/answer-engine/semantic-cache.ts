import { createHash } from 'crypto';
import { aceRuntime } from '../../../common/ai-cost-engine/ace-runtime';
import { versionsFor } from '../../../common/ai-cost-engine/version-keys';
import type { Signature } from './signature';
import { toLatinDigits } from './normalize';

// ACE-11 (نسخه‌ی v1: «دقیقاً همان سؤال») — کش جواب سؤال‌های سیاستی/ثابت.
// کلید = فروشگاه + scope + نیت + موجودیت‌ها + negated + متن نرمال‌شده؛ هر نسخه‌ای عوض شود miss.
// باند شباهت (cosine/verifier) عمداً نیست: اول فقط جواب سؤال عیناً تکراری.
const TTL_SEC = 60 * 60;
const SEEN_TTL_SEC = 60 * 60;
export const CACHEABLE_INTENTS = new Set(['ASK_WARRANTY_RETURN_POLICY', 'ASK_SHIPPING', 'ASK_CASH_ON_DELIVERY']);
const CACHEABLE_STATES = new Set(['GREETING', 'BROWSING']);
export const ALLOWED_TOOLS = new Set(['answer_faq', 'get_product_details', 'search_products', 'respond_to_customer']);

const DIRTY = /تومان|تومن|ریال|هزار|میلیون|موجود|تموم|ناموجود|امروز|فردا|امشب|الان|همین حالا|آخرین|فقط|محدود|تخفیف|کد |سفارش|رسید|کارت|شبا|@|https?:/;

export function replyIsClean(text: string): boolean {
  if (!text || text.length > 900) return false;
  if (/[0-9]/.test(toLatinDigits(text))) return false; // هر رقمی: قیمت، تلفن، کد، تعداد
  return !DIRTY.test(text);
}

export interface WriteEligibility {
  sig: Pick<Signature, 'intent' | 'negated'>;
  state: string;
  cartEmpty: boolean;
  toolsCalled: string[];
  mutationHappened: boolean;
  uiBlockType: string;
  dependent: boolean;
  replyText: string;
}

export function eligibleToStore(i: WriteEligibility): boolean {
  return (
    CACHEABLE_INTENTS.has(i.sig.intent) && !i.sig.negated && !i.dependent && CACHEABLE_STATES.has(i.state) &&
    i.cartEmpty && !i.mutationHappened && i.uiBlockType === 'NONE' &&
    i.toolsCalled.every((t) => ALLOWED_TOOLS.has(t)) && replyIsClean(i.replyText)
  );
}

export function eligibleToLookup(i: { sig: Pick<Signature, 'intent' | 'negated'>; state: string; cartEmpty: boolean; dependent: boolean }): boolean {
  return CACHEABLE_INTENTS.has(i.sig.intent) && !i.sig.negated && !i.dependent && CACHEABLE_STATES.has(i.state) && i.cartEmpty;
}

const sigHash = (sig: Signature) =>
  createHash('sha1').update([sig.scope, sig.intent, sig.entities.join(','), sig.negated ? 1 : 0, sig.norm].join('|')).digest('hex');
const entryKey = (storeId: string, sig: Signature) => `ace:sem:e:${storeId}:${sigHash(sig)}`;
const seenKey = (storeId: string, sig: Signature) => `ace:sem:seen:${storeId}:${sigHash(sig)}`;

export interface SemEntry { text: string; quickReplies: string[]; ver: string; createdAt: number; hits: number }

export async function semanticLookup(storeId: string, sig: Signature): Promise<SemEntry | null> {
  const redis = aceRuntime().redis;
  if (!redis) return null;
  try {
    const raw = await redis.get(entryKey(storeId, sig));
    if (!raw) return null;
    const e = JSON.parse(raw) as SemEntry;
    const ver = await versionsFor({ storeId, kb: true });
    if (!ver || ver !== e.ver) {
      await redis.del(entryKey(storeId, sig));
      return null;
    }
    return e;
  } catch {
    return null;
  }
}

// «دو بار دیده شود»: بار اول فقط امضا ثبت می‌شود، بار دوم (و جواب eligible) ذخیره
export async function semanticMaybeStore(storeId: string, sig: Signature, text: string, quickReplies: string[]): Promise<'seen' | 'stored' | 'skipped'> {
  const redis = aceRuntime().redis;
  if (!redis) return 'skipped';
  try {
    const n = await redis.incr(seenKey(storeId, sig));
    if (n === 1) {
      await redis.expire(seenKey(storeId, sig), SEEN_TTL_SEC);
      return 'seen';
    }
    const ver = await versionsFor({ storeId, kb: true });
    if (!ver) return 'skipped';
    const entry: SemEntry = { text, quickReplies, ver, createdAt: Date.now(), hits: 0 };
    await redis.set(entryKey(storeId, sig), JSON.stringify(entry), 'EX', TTL_SEC);
    return 'stored';
  } catch {
    return 'skipped';
  }
}
