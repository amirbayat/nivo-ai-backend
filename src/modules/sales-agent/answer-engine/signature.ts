import { COLORS, MAIN_CITIES, PROVINCES, applyLexicon } from './lexicon.fa';
import { normalizeFa } from './normalize';

// ACE-9 — امضای پیام: { norm, intent, entities, negated, scope }. خالص؛ نیت نامطمئن → UNCLEAR تا لایه کنار بکشد (I-8).
export type AceIntent =
  | 'ASK_PRICE' | 'STOCK_CHECK' | 'VARIANT_REQUEST' | 'ASK_SHIPPING' | 'ASK_WARRANTY_RETURN_POLICY'
  | 'ASK_PAYMENT_METHODS' | 'ASK_CASH_ON_DELIVERY' | 'NEGOTIATE_PRICE' | 'UNCLEAR';

export interface SigCatalogProduct { id: string; name: string }
export interface SigContext {
  catalog?: SigCatalogProduct[];
  optionValues?: string[]; // valueهای optionTypes فروشگاه
  anchoredProductId?: string | null;
  lastShownProductIds?: string[];
}
export interface Signature {
  norm: string;
  intent: AceIntent;
  entities: string[]; // مرتب و یکتا
  negated: boolean;
  scope: string; // p:{id} | store
}

const SIZE_RE = /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl)$/;
const NEG_RE = /(^| )(نه|نیست|نداره|ندارین|ندارید|ندارم|بدون|غیر از|غیر|نمی\S*|نبود)( |$)/;
const UNIT_RE = /(\d+(?:\.\d+)?) ?(گرم|کیلو|متر|سانتی ?متر|میل|میلی ?متر|لیتر|سی ?سی)/g;

const has = (s: string, w: string) => new RegExp(`(^| )${w}( |$)`).test(s);
const stripPossessive = (w: string) => w.replace(/(ش|شون|شو|ه)$/, '');

export function detectIntent(canon: string): AceIntent {
  const t = new Set(canon.split(' ').filter((w) => w.startsWith('_')));
  if (t.has('_DISCOUNT')) return 'NEGOTIATE_PRICE';
  if (t.has('_COD')) return 'ASK_CASH_ON_DELIVERY';
  const found: AceIntent[] = [];
  if (t.has('_PRICE')) found.push('ASK_PRICE');
  if (t.has('_SHIP_ETA') || t.has('_SHIP')) found.push('ASK_SHIPPING');
  if (t.has('_RETURN')) found.push('ASK_WARRANTY_RETURN_POLICY');
  if (t.has('_PAY')) found.push('ASK_PAYMENT_METHODS');
  if (t.has('_STOCK')) found.push('STOCK_CHECK');
  if (found.length === 0 && t.has('_HAVE')) found.push('STOCK_CHECK');
  if (found.length !== 1) return 'UNCLEAR'; // چند نیت یا هیچ‌کدام → LLM
  return found[0];
}

export function extractEntities(norm: string, ctx: SigContext = {}): string[] {
  const out = new Set<string>();
  const words = norm.split(' ');
  // واحدها (قبل از اعداد تا عدد دوباره جداگانه نیاید)
  let rest = norm.replace(UNIT_RE, (_m, n: string, u: string) => {
    out.add(`unit:${n}${u.replace(/ /g, '')}`);
    return ' ';
  });
  // سایز: «سایز ۴۰»، «سایز L»، یا حرف سایز مستقل
  rest = rest.replace(/سایز (\d{2}|xs|s|m|l|xl|xxl|xxxl)\b/g, (_m, z: string) => {
    out.add(`size:${z}`);
    return ' ';
  });
  for (const w of words) if (SIZE_RE.test(w)) out.add(`size:${w}`);
  if (/فری سایز|free size|freesize/.test(norm)) out.add('size:free');
  // رنگ
  const colorSet = [...COLORS, ...(ctx.optionValues ?? []).map((v) => normalizeFa(v))];
  for (const c of colorSet) {
    if (!c) continue;
    const re = new RegExp(`(^| )${c}(ش|شون|شو|ه|ی)?( |$)`);
    if (re.test(norm)) out.add(`opt:${c}`);
  }
  // شهر/استان
  for (const p of [...PROVINCES, ...MAIN_CITIES]) {
    const n = normalizeFa(p);
    if (new RegExp(`(^| )${n}( |$)`).test(norm)) out.add(`geo:${n}`);
  }
  // محصول
  for (const p of ctx.catalog ?? []) {
    const n = normalizeFa(p.name);
    if (n.length >= 3 && norm.includes(n)) out.add(`prod:${p.id}`);
  }
  // اعداد باقی‌مانده
  for (const m of rest.matchAll(/(^| )(\d+)( |$)/g)) out.add(`num:${m[2]}`);
  return [...out].sort();
}

export function buildSignature(text: string, ctx: SigContext = {}): Signature {
  const norm = normalizeFa(text);
  const canon = applyLexicon(norm);
  const entities = extractEntities(norm, ctx);
  let intent = detectIntent(canon);
  const hasOpt = entities.some((e) => e.startsWith('opt:') || e.startsWith('size:'));
  if (intent === 'STOCK_CHECK' && hasOpt) intent = 'VARIANT_REQUEST';
  // «ارسال به X» بدون شهر هم ASK_SHIPPING است ولی entity جغرافیایی لازم است تا جداپذیر باشد
  const negated = NEG_RE.test(norm);
  const prods = entities.filter((e) => e.startsWith('prod:'));
  let scope = 'store';
  if (prods.length === 1) scope = `p:${prods[0].slice(5)}`;
  else if (prods.length === 0 && ['ASK_PRICE', 'STOCK_CHECK', 'VARIANT_REQUEST'].includes(intent)) {
    if (ctx.anchoredProductId) scope = `p:${ctx.anchoredProductId}`;
    else if (ctx.lastShownProductIds?.length === 1) scope = `p:${ctx.lastShownProductIds[0]}`;
  }
  return { norm, intent, entities, negated, scope };
}

export { has as _has, stripPossessive as _stripPossessive };
