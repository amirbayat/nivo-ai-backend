// داده/منطق خالصی که باید بین مسیر export زیرنویس خام (ass-subtitle-builder.ts، دانلود .ass)
// و مسیر burn-in ویدیو (canvas-caption-renderer.ts) دقیقاً یکی بماند — پریست‌های استایل، فونت‌های
// مجاز، فرمول موقعیت‌دهی/پنجره‌ی هایلایت. بدون وابستگی به NestJS/Prisma (هم از ماژول‌های
// معمولی و هم از media-transcode.worker.ts که در Piscina worker thread اجرا می‌شود، قابل import).

import { join } from 'node:path';

export const FONTS_DIR = join(process.cwd(), 'assets', 'fonts');

export interface CaptionWord {
  word: string;
  start: number; // ثانیه، مطلق روی ویدیو
  end: number;
}

export interface CaptionSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words: CaptionWord[];
}

export interface CaptionStyleOverrides {
  fontFamily?: string;
  textColor?: string; // "#RRGGBB"
  highlightColor?: string; // "#RRGGBB"
  backgroundMode?: 'none' | 'translucent' | 'solid';
  fontSizePx?: number;
  position?: 'top' | 'center' | 'bottom';
  // مختصات آزاد (بخش جابجایی با درگ) — وقتی هر دو ست شده باشند، اولویت با این‌هاست، نه
  // position گسسته‌ی بالا (که فقط fallback پروژه‌های قدیمی است)
  positionX?: number; // نسبت ۰ تا ۱ از عرض ویدیو
  positionY?: number; // نسبت ۰ تا ۱ از ارتفاع ویدیو
  wordsPerLine?: number; // چند کلمه در هر خط نمایشی
  linesPerCue?: number; // ۱ یا ۲ — چند خط هم‌زمان روی صفحه
  styleId?: string; // کلید پریست از STYLE_PRESETS
}

export type CoreStyle = Omit<
  CaptionStyleOverrides,
  'positionX' | 'positionY' | 'styleId'
>;

export const DEFAULT_STYLE: Required<CoreStyle> = {
  fontFamily: 'Noto Naskh Arabic',
  textColor: '#FFFFFF',
  highlightColor: '#10B981', // برند امرالد nivo — همون رنگی که در پیش‌نمایش فرانت استفاده می‌شود
  backgroundMode: 'translucent',
  fontSizePx: 42,
  position: 'bottom',
  wordsPerLine: 4,
  linesPerCue: 1,
};

// ۴ پریست واقع‌بینانه با محدودیت‌های ASS/libass (بدون گوشه‌ی گرد یا glow واقعی — فقط
// رنگ/وزن فونت/outline/باکس). «ایران‌یکان» با وزن‌های Bold/ExtraBold از
// nivo-ai-frontend/src/assets/fonts/IRANYekanMsn داخل ایمیج داکر باندل شده (Dockerfile).
export interface StylePresetDefaults {
  fontFamily: string;
  textColor: string;
  highlightColor: string;
  backgroundMode: CaptionStyleOverrides['backgroundMode'];
  outlineWidth: number;
  outlineColorHex: string;
  boxColorHex: string;
}

export const STYLE_PRESETS: Record<string, StylePresetDefaults> = {
  default: {
    fontFamily: 'Noto Naskh Arabic',
    textColor: '#FFFFFF',
    highlightColor: '#10B981',
    backgroundMode: 'translucent',
    outlineWidth: 2,
    outlineColorHex: '#000000',
    boxColorHex: '#000000',
  },
  boldOutline: {
    fontFamily: 'IRANYekanMsn ExtraBold',
    textColor: '#FFFFFF',
    highlightColor: '#FBBF24',
    backgroundMode: 'none',
    outlineWidth: 5,
    outlineColorHex: '#000000',
    boxColorHex: '#000000',
  },
  neon: {
    fontFamily: 'Vazirmatn',
    textColor: '#22D3EE',
    highlightColor: '#F472B6',
    backgroundMode: 'none',
    outlineWidth: 3,
    outlineColorHex: '#7C3AED',
    boxColorHex: '#000000',
  },
  speakerBox: {
    fontFamily: 'IRANYekanMsn',
    textColor: '#FFFFFF',
    highlightColor: '#FBBF24',
    backgroundMode: 'solid',
    outlineWidth: 1,
    outlineColorHex: '#000000',
    boxColorHex: '#1E1B4B',
  },
};

// فونت‌هایی که واقعاً روی ایمیج داکر نصب‌اند (Dockerfile/Dockerfile.prod، assets/fonts/*.ttf
// نصب‌شده در fontconfig) — اگر fontFamily ورودی (کاربر یا پریست) در این لیست نباشد، silently
// به پیش‌فرض برمی‌گردیم؛ وگرنه fontconfig یک فونت جایگزین غیرقابل‌پیش‌بینی انتخاب می‌کند
// بدون هیچ خطایی. «IRANYekanMsn ExtraBold» یک نام خانواده‌ی مجزاست (فایل فونت این‌طور
// name-table دارد)؛ برای Bold از همون خانواده‌ی IRANYekanMsn/Vazirmatn با فلگ Bold استفاده
// می‌شود (نه یک نام خانواده‌ی جدا) — به همین خاطر هیچ «X Bold» دیگری در این لیست نیست.
export const ALLOWED_FONTS = new Set([
  'Noto Naskh Arabic',
  'IRANYekanMsn',
  'IRANYekanMsn ExtraBold',
  'Vazirmatn',
  'Tahoma',
]);

// خانواده‌ی «IRANYekanMsn ExtraBold» خودش از قبل سنگین‌ترین وزن است — فلگ Bold روی آن اضافه
// نمی‌شود (وگرنه libass با bold مصنوعی رویش، بیش‌ازحد سنگین می‌شود)؛ بقیه‌ی خانواده‌ها (که هم
// وزن Regular هم Bold دارند) با فلگ Bold=-1 وزن Bold واقعی‌شان انتخاب می‌شود.
export function boldFlagFor(fontFamily: string): number {
  return fontFamily === 'IRANYekanMsn ExtraBold' ? 0 : -1;
}

export interface FontFiles {
  regular: string;
  bold: string;
}

// باید دقیقاً همان فایل‌هایی باشد که Dockerfile/Dockerfile.prod در assets/fonts/ نصب می‌کنند
// (و از همان‌جا هم به /usr/share/fonts/nivo/ کپی می‌شود) — تا فونت رندر (libass یا canvas) و
// فونت اندازه‌گیری (text-shaping.ts) دقیقاً یکی باشند، وگرنه هایلایت چند پیکسل جابه‌جا می‌شود.
export const FONT_FILES: Record<string, FontFiles> = {
  'Noto Naskh Arabic': {
    regular: 'NotoNaskhArabic-Regular.ttf',
    bold: 'NotoNaskhArabic-Bold.ttf',
  },
  Vazirmatn: { regular: 'Vazirmatn-Regular.ttf', bold: 'Vazirmatn-Bold.ttf' },
  IRANYekanMsn: {
    regular: 'IRANYekanRegularMsn.ttf',
    bold: 'IRANYekanBoldMsn.ttf',
  },
  'IRANYekanMsn ExtraBold': {
    regular: 'IRANYekanExtraBoldMsn.ttf',
    bold: 'IRANYekanExtraBoldMsn.ttf',
  },
  // فایل Tahoma باندل نشده (هیچ‌کدام از STYLE_PRESETS ازش استفاده نمی‌کنند، فقط برای
  // styleOverrides دلخواه‌ی قدیمی در ALLOWED_FONTS مانده) — تقریب با Noto Naskh Arabic
  // بهتر از کرش کردن است.
  Tahoma: {
    regular: 'NotoNaskhArabic-Regular.ttf',
    bold: 'NotoNaskhArabic-Bold.ttf',
  },
};

// docs/PRD-video-auto-captions.md §۵.۱/§۸.۱ — تبدیل segments (بخش ۶: cueهای ادیت‌شده‌ی
// کاربر) + styleOverrides به یک فایل .ass قابل‌مصرف توسط ffmpeg (فیلتر ass=، از طریق
// libass). عمداً بدون وابستگی به NestJS/Prisma (قابل unit-test مستقل) — ولی دیگر کاملاً
// «بدون I/O» نیست: برای موقعیت‌دهی پیکسلی هایلایت کلمه‌به‌کلمه (پایین‌تر) از text-shaping.ts
// استفاده می‌کند که فایل فونت را از دیسک می‌خواند (cache شده، فقط یک‌بار به‌ازای هر فونت).
export function buildDefaultSegments(
  words: CaptionWord[],
  wordsPerLine = 4,
  linesPerCue = 1,
): CaptionSegment[] {
  const perCue = Math.max(1, wordsPerLine) * Math.max(1, linesPerCue);
  const segments: CaptionSegment[] = [];
  for (let i = 0; i < words.length; i += perCue) {
    const group = words.slice(i, i + perCue);
    if (group.length === 0) continue;
    segments.push({
      id: `seg-${i}`,
      startMs: Math.round(group[0].start * 1000),
      endMs: Math.round(group[group.length - 1].end * 1000),
      text: group.map((w) => w.word.trim()).join(' '),
      words: group,
    });
  }
  return segments;
}

// جابجایی آزاد با درگ (نه فقط ۳ حالت گسسته) — وقتی positionX/Y ست نشده، از position قدیمی
// (بالا/وسط/پایین) به‌عنوان fallback پروژه‌های قدیمی استفاده می‌شود
export function resolvePositionRatio(style: CaptionStyleOverrides): {
  x: number;
  y: number;
} {
  const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
  if (
    typeof style.positionX === 'number' &&
    typeof style.positionY === 'number'
  ) {
    return { x: clamp(style.positionX), y: clamp(style.positionY) };
  }
  const y =
    style.position === 'top' ? 0.12 : style.position === 'center' ? 0.5 : 0.88;
  return { x: 0.5, y };
}

// هایلایت: هر کلمه از پایان کلمه‌ی قبلی تا شروع کلمه‌ی بعدی «فعال» حساب می‌شود (نه دقیقاً
// بازه‌ی خودش) — این‌طور بدون سوسوزدن بین کلمات هایلایت جابه‌جا می‌شود (بخش ۵.۲/۸.۱). دو
// مصرف‌کننده دارد: ass-subtitle-builder.ts (یک Dialogue جدا به‌ازای هر بازه) و
// canvas-caption-renderer.ts (یک فریم جدا به‌ازای هر بازه).
export interface WordHighlightInterval {
  /** ایندکس کلمه در segment.words — برای نگاشت به متن/موقعیت همان کلمه لازم است */
  wordIndex: number;
  startMs: number;
  endMs: number;
}

export function computeWordHighlightIntervals(
  segment: CaptionSegment,
): WordHighlightInterval[] {
  const words = segment.words ?? [];
  const intervals: WordHighlightInterval[] = [];
  for (let i = 0; i < words.length; i++) {
    const startMs =
      i === 0 ? segment.startMs : Math.round(words[i].start * 1000);
    const endMs =
      i === words.length - 1
        ? segment.endMs
        : Math.round(words[i + 1].start * 1000);
    if (endMs <= startMs) continue;
    intervals.push({ wordIndex: i, startMs, endMs });
  }
  return intervals;
}
