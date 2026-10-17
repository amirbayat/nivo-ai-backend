import type { ShadowSample, Verdict } from './shadow-store';

// بند ACE-12 — دروازه‌ی روشن کردن. مدل judge مرجع نهایی نیست: برای نیت‌های حساس بازبینی انسانی هم لازم است.
export const SENSITIVE_INTENTS = new Set([
  'VARIANT_REQUEST', 'ASK_RETURN', 'ASK_WARRANTY_RETURN_POLICY', 'ASK_DISCOUNT', 'ASK_SHIPPING', 'CHECKOUT', 'NEGOTIATE_PRICE',
]);
export const MIN_SAMPLES = 200;
export const MIN_PER_STRATUM = 30;
export const MIN_HUMAN_SENSITIVE = 50;

// حکم نهایی نمونه: انسان اگر داده، وگرنه judge
export const finalVerdict = (s: ShadowSample): Verdict | null => s.human?.verdict ?? s.judge?.verdict ?? null;

interface Counts { n: number; equal: number; worse: number; wrong: number; pending: number }
const empty = (): Counts => ({ n: 0, equal: 0, worse: 0, wrong: 0, pending: 0 });
const add = (c: Counts, v: Verdict | null) => {
  c.n++;
  if (!v) c.pending++;
  else c[v]++;
};

export interface GateRule { minEqualPct?: number; maxWorsePct?: number; maxWrong?: number }
// پیشنهاد سند؛ تصمیم نهایی با کاربر
export const GATES: Record<string, GateRule> = {
  fastAnswers: { maxWrong: 0, maxWorsePct: 5 },
  productBrief: { maxWrong: 0, maxWorsePct: 5 },
  'semanticCache:exact': { minEqualPct: 98 },
  'semanticCache:high': { minEqualPct: 98 },
  'semanticCache:verified': { minEqualPct: 95 },
};
const gateKey = (layer: string, band?: string) => (layer === 'semanticCache' && band ? `semanticCache:${band}` : layer);

export interface StratumReport extends Counts { key: string; passes: boolean; reason: string }

function evaluate(c: Counts, rule: GateRule, minN: number): { passes: boolean; reason: string } {
  const judged = c.n - c.pending;
  if (judged < minN) return { passes: false, reason: `نمونه‌ی داوری‌شده ${judged}/${minN}` };
  if (rule.maxWrong !== undefined && c.wrong > rule.maxWrong) return { passes: false, reason: `wrong=${c.wrong}` };
  const pct = (x: number) => (x / judged) * 100;
  if (rule.maxWorsePct !== undefined && pct(c.worse) > rule.maxWorsePct) return { passes: false, reason: `worse=${pct(c.worse).toFixed(1)}٪` };
  if (rule.minEqualPct !== undefined && pct(c.equal) < rule.minEqualPct) return { passes: false, reason: `equal=${pct(c.equal).toFixed(1)}٪` };
  return { passes: true, reason: 'ok' };
}

export interface LayerReport {
  layer: string;
  total: Counts;
  gate: { passes: boolean; reason: string };
  byIntent: StratumReport[];
  byTag: StratumReport[];
  byCategory: StratumReport[];
  humanSensitive: { reviewed: number; wrong: number; passes: boolean };
  judgeHumanDisagree: number;
  wrongSamples: Array<{ id: string; customerMessage: string; realText: string; candidateText: string; reason: string }>;
}

// دروازه‌ی هر لایه فقط وقتی باز است که: کل نمونه‌ها + هر stratum (حداقل ۳۰) + بازبینی انسانی نیت‌های حساس پاس باشند.
export function buildLayerReport(layer: string, all: ShadowSample[], band?: string): LayerReport {
  const rule = GATES[gateKey(layer, band)] ?? GATES[layer] ?? { maxWrong: 0, maxWorsePct: 5 };
  const samples = all.filter((s) => s.layer === layer && (band === undefined || s.band === band));
  const total = empty();
  const groups = { intent: new Map<string, Counts>(), tag: new Map<string, Counts>(), category: new Map<string, Counts>() };
  const bump = (m: Map<string, Counts>, k: string, v: Verdict | null) => {
    const c = m.get(k) ?? empty();
    add(c, v);
    m.set(k, c);
  };
  let disagree = 0;
  let sensReviewed = 0;
  let sensWrong = 0;
  for (const s of samples) {
    const v = finalVerdict(s);
    add(total, v);
    bump(groups.intent, s.intent, v);
    for (const t of s.tags) bump(groups.tag, t, v);
    bump(groups.category, s.storeCategory ?? 'نامشخص', v);
    if (s.human && s.judge && s.human.verdict !== s.judge.verdict) disagree++;
    if (s.human && SENSITIVE_INTENTS.has(s.intent)) {
      sensReviewed++;
      if (s.human.verdict === 'wrong') sensWrong++;
    }
  }
  const toStrata = (m: Map<string, Counts>): StratumReport[] =>
    [...m.entries()]
      .map(([k, c]) => ({ key: k, ...c, ...evaluate(c, rule, MIN_PER_STRATUM) }))
      .sort((a, b) => b.n - a.n);
  const byIntent = toStrata(groups.intent);
  const hasSensitive = samples.some((s) => SENSITIVE_INTENTS.has(s.intent));
  const humanSensitive = {
    reviewed: sensReviewed,
    wrong: sensWrong,
    passes: !hasSensitive || (sensReviewed >= MIN_HUMAN_SENSITIVE && sensWrong === 0),
  };
  const base = evaluate(total, rule, MIN_SAMPLES);
  const failedStratum = byIntent.find((x) => !x.passes);
  const gate = !base.passes
    ? base
    : failedStratum
      ? { passes: false, reason: `نیت ${failedStratum.key}: ${failedStratum.reason}` }
      : !humanSensitive.passes
        ? { passes: false, reason: `بازبینی انسانی نیت‌های حساس ${sensReviewed}/${MIN_HUMAN_SENSITIVE}` }
        : base;
  return {
    layer,
    total,
    gate,
    byIntent,
    byTag: toStrata(groups.tag),
    byCategory: toStrata(groups.category),
    humanSensitive,
    judgeHumanDisagree: disagree,
    wrongSamples: samples
      .filter((s) => finalVerdict(s) === 'wrong')
      .slice(0, 20)
      .map((s) => ({
        id: s.id, customerMessage: s.customerMessage, realText: s.realText, candidateText: s.candidateText,
        reason: s.human?.note ?? s.judge?.reason ?? '',
      })),
  };
}

// نمونه‌هایی که judge باید ببیند: لایه‌بندی‌شده (stratum کم‌نمونه اول)، حداکثر limit
export function pickForJudging(all: ShadowSample[], limit: number): ShadowSample[] {
  const pending = all.filter((s) => !s.judge && !s.human);
  const judgedPerKey = new Map<string, number>();
  for (const s of all) if (s.judge || s.human) judgedPerKey.set(`${s.layer}|${s.intent}`, (judgedPerKey.get(`${s.layer}|${s.intent}`) ?? 0) + 1);
  const taken = new Map<string, number>();
  const out: ShadowSample[] = [];
  const pool = [...pending];
  while (out.length < limit && pool.length) {
    // هر دور، نمونه‌ای از stratumی که کمترین داوری (شامل انتخاب‌های همین دور) را دارد
    let bestIdx = 0;
    let best = Infinity;
    pool.forEach((s, i) => {
      const k = `${s.layer}|${s.intent}`;
      const c = (judgedPerKey.get(k) ?? 0) + (taken.get(k) ?? 0);
      if (c < best) { best = c; bestIdx = i; }
    });
    const [s] = pool.splice(bestIdx, 1);
    const k = `${s.layer}|${s.intent}`;
    taken.set(k, (taken.get(k) ?? 0) + 1);
    out.push(s);
  }
  return out;
}
