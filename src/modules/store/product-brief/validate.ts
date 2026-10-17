import type { BriefLlmOutput, ValidatedBrief } from './brief.schema';
import { normForMatch } from './normalize';
import type { BriefSection } from './section-splitter';
import { BRIEF_TOPICS, topicFromHeading, type BriefTopic } from './topics';

const HEDGE = /پیشنهادی|باید تایید|تایید شود|تاییدش|حدود|حدودا|بسته به|احتمالا|تقریبا|شاید|نامشخص/;
const MONEY = /تومان|تومن|هزار|ریال|میلیون|تخفیف|ارزون|ارزان/;
const URGENCY = /فقط امروز|آخرین|تموم میشه|تمام میشه|محدود|فرصت|عجله|رو به اتمام|تا پایان/;
const SUPERLATIVE = /بهترین|بی ?نظیر|عالی ترین|بی ?رقیب|ممتاز|بی ?همتا/;
// ادعاهایی که اگر در منبع نباشند حتماً ساختگی‌اند
const RISKY_CLAIMS = ['ضد اب', 'اصل', 'اورجینال', 'ارگانیک', 'ضدحساسیت', 'ضد حساسیت', 'گارانتی', 'دست دوز', 'دستباف', 'طبیعی ۱۰۰'];
const STOP = new Set(['این', 'برای', 'خیلی', 'هم', 'و', 'با', 'از', 'که', 'رو', 'را', 'به', 'در', 'یک', 'هر', 'تا', 'یا', 'است', 'می', 'شده']);

const hasDigit = (s: string) => /\d/.test(s);
const nums = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
const words = (s: string) => s.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP.has(w));

export interface ValidateInput {
  text: string; // normalizeDescription(description)
  sections: BriefSection[];
  specs: Array<{ label: string; value: string }>;
  optionTypes: Array<{ name: string; values: string[] }>;
}

const sectionText = (inp: ValidateInput, id: string): string | null => {
  const s = inp.sections.find((x) => x.id === id);
  return s ? inp.text.slice(s.start, s.end) : null;
};

// بند ۱۶.۴-۱: ریشه داشتن. برمی‌گرداند: پیدا شد؟ و (برای قید اجباری) خطی که مقدار در آن است
function rootedLine(v: string, secNorm: string): { ok: boolean; line: string | null } {
  const vn = normForMatch(v);
  if (!vn) return { ok: false, line: null };
  const lines = secNorm.split('\n');
  const direct = lines.find((l) => l.includes(vn));
  if (direct !== undefined || secNorm.includes(vn)) return { ok: true, line: direct ?? secNorm };
  const ns = nums(vn);
  const ws = words(vn.replace(/\d+(?:\.\d+)?/g, ' '));
  if (ns.length && ns.every((n) => secNorm.includes(n)) && ws.some((w) => secNorm.includes(w))) {
    const w = ws.find((x) => secNorm.includes(x))!;
    return { ok: true, line: lines.find((l) => l.includes(w)) ?? secNorm };
  }
  return { ok: false, line: null };
}

function pitchLineOk(s: string): boolean {
  const n = normForMatch(s);
  if (!n || hasDigit(n)) return false;
  return !MONEY.test(n) && !URGENCY.test(n) && !SUPERLATIVE.test(n);
}

function sourceTextFor(src: string, inp: ValidateInput): string {
  const s = normForMatch(src);
  if (s.startsWith('specs')) {
    const label = normForMatch(src.replace(/^specs\.?/i, ''));
    const hit = inp.specs.filter((x) => !label || normForMatch(x.label).includes(label));
    return normForMatch(hit.map((x) => `${x.label} ${x.value}`).join(' '));
  }
  if (s.startsWith('option')) return normForMatch(inp.optionTypes.map((o) => `${o.name} ${o.values.join(' ')}`).join(' '));
  return normForMatch(inp.text);
}

export function validateBrief(out: BriefLlmOutput, inp: ValidateInput): {
  brief: ValidatedBrief;
  topics: Record<string, BriefTopic[]>;
  ok: boolean;
  stats: { factsIn: number; factsKept: number };
} {
  const secNorm = new Map(inp.sections.map((s) => [s.id, normForMatch(inp.text.slice(s.start, s.end))]));

  // facts
  const facts: ValidatedBrief['facts'] = [];
  for (const f of out.facts.slice(0, 12)) {
    const sn = secNorm.get(f.src);
    const v = f.v.trim();
    if (!sn || !v || v.length > 60 || !f.k.trim()) continue;
    const r = rootedLine(v, sn);
    if (!r.ok) continue;
    // کد فقط می‌تواند sure را پایین بیاورد
    const hedged = r.line ? HEDGE.test(r.line) : false;
    facts.push({ k: f.k.trim(), v, sure: f.sure && !hedged, src: f.src });
  }

  const quotes = (arr: Array<{ quote: string; src: string }>): ValidatedBrief['caveats'] => {
    const res: ValidatedBrief['caveats'] = [];
    for (const q of arr) {
      const sn = secNorm.get(q.src);
      const qn = normForMatch(q.quote);
      if (!sn || !qn || !sn.includes(qn)) continue;
      res.push({ quote: q.quote.trim(), src: q.src });
    }
    return res;
  };
  const caveats = quotes(out.caveats);
  // بند ۱۶.۴-۴: قیمت در دستورها ممنوع (رقم + واحد پول)
  const sellerRules = quotes(out.sellerRules).filter((r) => {
    const n = normForMatch(r.quote);
    return !(hasDigit(n) && MONEY.test(n));
  });

  // pitch (قوانین ACE-10.1)
  const benefits: string[] = [];
  const benefitSources: string[] = [];
  out.pitch.benefits.forEach((b, i) => {
    const src = out.pitch.benefitSources[i];
    if (!src || b.length > 120 || !pitchLineOk(b)) return;
    const st = sourceTextFor(src, inp);
    const bn = normForMatch(b);
    if (!st) return;
    const overlap = words(bn).some((w) => w.length >= 3 && st.includes(w));
    const unsupported = RISKY_CLAIMS.some((c) => bn.includes(c) && !st.includes(c));
    if (!overlap || unsupported) return;
    benefits.push(b.trim());
    benefitSources.push(src);
  });
  const clean = (arr: string[], max: number) => arr.filter(pitchLineOk).slice(0, max).map((s) => s.trim());
  const pitch = benefits.length >= 2
    ? {
        benefits: benefits.slice(0, 5),
        benefitSources: benefitSources.slice(0, 5),
        valueLines: clean(out.pitch.valueLines, 2),
        followUps: clean(out.pitch.followUps, 3),
        openers: clean(out.pitch.openers, 3),
      }
    : null;

  // موضوع‌ها: فرهنگ عنوان اول (heading ?? context)؛ بعد LLM؛ بی‌موضوع → OTHER
  const llmTopics = new Map(out.sectionTopics.map((t) => [t.id, t.topics]));
  const topics: Record<string, BriefTopic[]> = {};
  for (const s of inp.sections) {
    const fromDict = topicFromHeading(s.heading) ?? topicFromHeading(s.context);
    const set: BriefTopic[] = [];
    if (fromDict) set.push(fromDict);
    for (const t of llmTopics.get(s.id) ?? []) if (BRIEF_TOPICS.includes(t) && !set.includes(t)) set.push(t);
    topics[s.id] = (set.length ? set : (['OTHER'] as BriefTopic[])).slice(0, 3);
  }

  const factsIn = out.facts.length;
  return {
    brief: {
      facts,
      caveats,
      sellerRules,
      pitch,
      textPriceStock: {
        prices: out.textPriceStock.prices.slice(0, 6),
        stockMentions: out.textPriceStock.stockMentions.slice(0, 6),
      },
    },
    topics,
    // بند ۱۶.۴-۶: کمتر از نصف facts ماند → شکست
    ok: factsIn === 0 || facts.length * 2 >= factsIn,
    stats: { factsIn, factsKept: facts.length },
  };
}

export { sectionText };
