import type { ValidatedBrief } from './brief.schema';
import { splitSections } from './section-splitter';
import type { BriefTopic } from './topics';

// بند ۱۶.۵ — توابع خالص مصرف برگه در prompt و ابزار read_product_section
export interface StoredSection {
  id: string;
  heading: string | null;
  context: string | null;
  start: number;
  end: number;
  topics: BriefTopic[];
}

export interface BriefRow {
  descHash: string;
  status: string;
  sections: StoredSection[];
  brief: ValidatedBrief;
}

export const MIN_DESCRIPTION_FOR_BRIEF = 600; // کوتاه‌تر: صرفه‌ای ندارد، متن کامل
const OVERVIEW_MAX = 300;
const RULES_MAX = 800;
const MAX_READ_SECTIONS = 3;

const TOPIC_LABEL: Record<BriefTopic, string> = {
  OVERVIEW: 'معرفی', SPECS: 'مشخصات', SIZE_FIT: 'سایز و اندازه', VARIANTS_STOCK: 'رنگ و موجودی', CARE: 'نگهداری',
  USAGE_STYLING: 'کاربرد و ست کردن', COMPARISON: 'تفاوت با مدل‌های مشابه', POLICY: 'ارسال/مرجوعی/گارانتی',
  COMPATIBILITY: 'سازگاری', SELLER_RULES: 'نکات برای دستیار فروش', OTHER: 'سایر توضیحات',
};

export const sectionLabel = (s: StoredSection): string => s.heading ?? s.context ?? TOPIC_LABEL[s.topics[0] ?? 'OTHER'];
// موجودی و رنگ هرگز به prompt نمی‌روند؛ فقط از DB
const hidden = (s: StoredSection) => s.topics.includes('VARIANTS_STOCK');

export function isBriefUsable(row: BriefRow | null | undefined, hashNow: string, descriptionLength: number): row is BriefRow {
  return !!row && row.status === 'ok' && row.descHash === hashNow && descriptionLength > MIN_DESCRIPTION_FOR_BRIEF && Array.isArray(row.sections);
}

const slice = (text: string, s: StoredSection) => text.slice(s.start, s.end);

// جایگزین «— توضیحات: …» در خط facts محصول. text باید همان normalizeDescription(description) باشد.
export function renderBriefFacts(row: BriefRow, text: string): string {
  const parts: string[] = [];
  const overview = row.sections.find((s) => s.topics.includes('OVERVIEW') && !hidden(s));
  if (overview) {
    const t = slice(text, overview);
    parts.push(`معرفی: ${t.length > OVERVIEW_MAX ? `${t.slice(0, OVERVIEW_MAX)}...` : t}`);
  }
  if (row.brief.facts.length) {
    parts.push(`واقعیت‌ها: ${row.brief.facts.map((f) => `${f.k}: ${f.v}${f.sure ? '' : ' (؟ فروشنده مطمئن نیست)'}`).join('؛ ')}`);
  }
  if (row.brief.caveats.length) parts.push(`قیدها: ${row.brief.caveats.map((c) => `«${c.quote}»`).join(' ')}`);
  const rules = row.sections.filter((s) => s.topics.includes('SELLER_RULES') && !hidden(s)).map((s) => slice(text, s)).join('\n');
  if (rules) parts.push(`دستور فروشنده به تو: ${rules.length > RULES_MAX ? `${rules.slice(0, RULES_MAX)}...` : rules}`);
  const index = row.sections.filter((s) => !hidden(s) && !s.topics.includes('SELLER_RULES') && s !== overview);
  if (index.length) parts.push(`بخش‌های دیگر توضیح (متن کامل با read_product_section): ${index.map((s) => `${s.id} ${sectionLabel(s)}`).join(' · ')}`);
  return parts.join(' — ');
}

export function readSections(
  row: BriefRow,
  text: string,
  ids: string[],
): Array<{ id: string; title: string; text: string }> {
  const out: Array<{ id: string; title: string; text: string }> = [];
  for (const id of ids) {
    if (out.length >= MAX_READ_SECTIONS) break;
    const s = row.sections.find((x) => x.id === id);
    if (!s || hidden(s) || out.some((o) => o.id === id)) continue;
    out.push({ id: s.id, title: sectionLabel(s), text: slice(text, s) });
  }
  return out;
}

// فقط برای تست/ابزار: متن نرمال‌شده‌ی توضیح
export const briefText = (description: string | null | undefined): string => splitSections(description).text;

export const BRIEF_PROMPT_RULE =
  '- اگر جواب سؤال مشتری در «واقعیت‌ها/قیدها» نیست و در فهرست «بخش‌های دیگر توضیح» یک بخش مرتبط هست، ' +
  'قبل از جواب read_product_section را با شناسه‌ی همان بخش صدا بزن. واقعیتی که با «؟» علامت خورده را قطعی نگو ' +
  '(مثلاً «فروشنده گفته حدوداً…» یا «دقیقش رو می‌پرسم»). قیمت و موجودی را فقط از ابزار/خط اصلی محصول بگو.';
