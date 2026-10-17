import { normalizeDescription } from './normalize';

export interface BriefSection {
  id: string;
  // عنوان خودِ بخش (اگر خط/درون‌خط عنوان داشت)
  heading: string | null;
  // نزدیک‌ترین عنوان قبلی؛ برای بخش‌های ادامه‌ی همان عنوان (فرهنگ عنوان‌ها از heading ?? context می‌خواند)
  context: string | null;
  start: number;
  end: number;
}

const MIN_SECTION = 80;
const MAX_SECTION = 1200;
const FLAT_CHUNK = 400;

const BULLET = /^\s*([-•●▪*]|\d+[.)])\s+/;
const FULL_BOLD = /^\*\*([^*\n]{1,60}?)\*\*:?$/;
const MD_HEADING = /^#{1,6}\s+(.+)$/;
const INLINE_BOLD = /^\*\*([^*\n]{1,40}?):?\*\*:?\s*\S/;
const INLINE_BOLD_COLON = /^\*\*([^*\n]{1,40}?:)\*\*\s*\S/;

const cleanHeading = (h: string) => h.replace(/[*#]/g, '').replace(/[:：]\s*$/, '').trim();

type Line = { text: string; start: number; end: number };
type LineKind = { kind: 'blank' } | { kind: 'heading'; heading: string } | { kind: 'inline'; heading: string } | { kind: 'text' };

function classify(line: string): LineKind {
  const t = line.trim();
  if (!t) return { kind: 'blank' };
  let m = FULL_BOLD.exec(t);
  if (m) return { kind: 'heading', heading: cleanHeading(m[1]) };
  m = MD_HEADING.exec(t);
  if (m) return { kind: 'heading', heading: cleanHeading(m[1]) };
  if (t.length <= 40 && /[:：]$/.test(t) && !BULLET.test(t)) return { kind: 'heading', heading: cleanHeading(t) };
  m = INLINE_BOLD_COLON.exec(t) ?? INLINE_BOLD.exec(t);
  if (m) return { kind: 'inline', heading: cleanHeading(m[1]) };
  return { kind: 'text' };
}

function toLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    out.push({ text: raw, start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }
  return out;
}

interface Block { heading: string | null; start: number; end: number }

// شکستن تکه‌ی بلند روی مرز جمله، حداکثر ~max کاراکتر (offsetها روی متن اصلی می‌مانند)
function splitBySentence(text: string, start: number, end: number, max: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = start;
  while (end - s > max) {
    const win = text.slice(s, s + max);
    let cut = -1;
    const re = /[.!؟?!۔]+\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(win))) cut = m.index + m[0].length;
    if (cut < max * 0.4) {
      const sp = win.lastIndexOf(' ');
      cut = sp > max * 0.4 ? sp + 1 : max;
    }
    out.push([s, s + cut]);
    s += cut;
  }
  if (end > s) out.push([s, end]);
  // فاصله‌ی انتهایی هر تکه را از بخش بیرون بریز
  return out.map(([a, b]) => {
    let bb = b;
    while (bb > a && /\s/.test(text[bb - 1])) bb--;
    return [a, bb] as [number, number];
  });
}

// شکستن بخش بلند روی مرز پاراگراف/bullet؛ در نبودشان مرز جمله
function splitLong(text: string, start: number, end: number): Array<[number, number]> {
  if (end - start <= MAX_SECTION) return [[start, end]];
  const lines = toLines(text.slice(start, end)).map((l) => ({ ...l, start: l.start + start, end: l.end + start }));
  const hasNewline = lines.length > 1;
  if (!hasNewline) return splitBySentence(text, start, end, FLAT_CHUNK);
  const parts: Array<[number, number]> = [];
  let curStart = lines[0].start;
  let curEnd = lines[0].end;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const isBoundary = !l.text.trim() ? false : BULLET.test(l.text) || !lines[i - 1].text.trim();
    if (isBoundary && l.end - curStart > MAX_SECTION && curEnd > curStart) {
      parts.push([curStart, curEnd]);
      curStart = l.start;
    }
    if (l.text.trim()) curEnd = l.end;
  }
  parts.push([curStart, curEnd]);
  return parts.flatMap(([a, b]) => (b - a > MAX_SECTION ? splitBySentence(text, a, b, MAX_SECTION) : [[a, b] as [number, number]]));
}

// بند ۱۶.۱ — تابع خالص. offsetها روی normalizeDescription(raw) هستند.
export function splitSections(raw: string | null | undefined): { text: string; sections: BriefSection[] } {
  const text = normalizeDescription(raw);
  if (!text) return { text, sections: [] };
  const lines = toLines(text);

  // ۱) بلوک‌ها: عنوان/عنوان درون‌خطی/خط خالی مرز است؛ خط عنوانِ تنها به پاراگراف بعدش می‌چسبد
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let pendingHeadingOnly = false;
  for (const l of lines) {
    const k = classify(l.text);
    if (k.kind === 'blank') {
      if (cur && !pendingHeadingOnly) {
        blocks.push(cur);
        cur = null;
      }
      continue;
    }
    if (k.kind === 'heading') {
      if (cur) blocks.push(cur);
      cur = { heading: k.heading, start: l.start, end: l.end };
      pendingHeadingOnly = true;
      continue;
    }
    if (k.kind === 'inline') {
      if (cur) blocks.push(cur);
      cur = { heading: k.heading, start: l.start, end: l.end };
      pendingHeadingOnly = false;
      continue;
    }
    if (!cur) cur = { heading: null, start: l.start, end: l.end };
    else cur.end = l.end;
    pendingHeadingOnly = false;
  }
  if (cur) blocks.push(cur);

  // ۲) ادغام بخش کوتاه (< ۸۰) در قبلی؛ بخشی که خودش عنوان دارد ادغام نمی‌شود تا برچسب موضوعش از بین نرود
  const merged: Block[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && !b.heading && b.end - b.start < MIN_SECTION) prev.end = b.end;
    else merged.push({ ...b });
  }
  // اولین بخش کوتاهِ بی‌عنوان (قبل از هر چیز) به بعدی می‌چسبد
  if (merged.length > 1 && !merged[0].heading && merged[0].end - merged[0].start < MIN_SECTION) {
    merged[1].start = merged[0].start;
    merged.shift();
  }

  // ۳) برش بخش‌های بلند + ساخت خروجی
  const sections: BriefSection[] = [];
  let ctx: string | null = null;
  for (const b of merged) {
    if (b.heading) ctx = b.heading;
    const parts = splitLong(text, b.start, b.end);
    parts.forEach(([s, e], i) => {
      sections.push({
        id: `s${sections.length + 1}`,
        heading: i === 0 ? b.heading : null,
        context: i === 0 ? (b.heading ? null : ctx) : ctx,
        start: s,
        end: e,
      });
    });
  }
  return { text, sections };
}
