// docs/PRD-video-auto-captions.md §۵.۱/§۸.۱ — تبدیل segments (بخش ۶: cueهای ادیت‌شده‌ی
// کاربر) + styleOverrides به یک فایل .ass قابل‌مصرف توسط ffmpeg (فیلتر ass=، از طریق
// libass). عمداً یک تابع خالص (بدون وابستگی به NestJS/Prisma) — هم قابل unit-test مستقل،
// هم چون این فایل صرفاً روی داده‌ی JSON کار می‌کند، نه I/O.

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

type CoreStyle = Omit<CaptionStyleOverrides, 'positionX' | 'positionY' | 'styleId'>;

// اگر کاربر هیچ ادیتی نکرده باشد (segments هنوز null است)، همون گروه‌بندی ساده‌ی پیش‌فرض
// (هر wordsPerLine×linesPerCue کلمه یک cue) از transcriptWords ساخته می‌شود — کاربر نباید
// مجبور باشد قبل از اولین رندر/export حتماً دستی ادیت کند (docs/PRD-video-auto-captions.md
// §۳/§۵.۲). هم caption-render و هم export فایل خام (بخش ۸.۲) از همین تابع استفاده می‌کنند.
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

const DEFAULT_STYLE: Required<CoreStyle> = {
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
interface StylePresetDefaults {
  fontFamily: string;
  textColor: string;
  highlightColor: string;
  backgroundMode: CaptionStyleOverrides['backgroundMode'];
  outlineWidth: number;
  outlineColorHex: string;
  boxColorHex: string;
}

const STYLE_PRESETS: Record<string, StylePresetDefaults> = {
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
const ALLOWED_FONTS = new Set([
  'Noto Naskh Arabic',
  'IRANYekanMsn',
  'IRANYekanMsn ExtraBold',
  'Vazirmatn',
  'Tahoma',
]);

// خانواده‌ی «IRANYekanMsn ExtraBold» خودش از قبل سنگین‌ترین وزن است — فلگ Bold روی آن اضافه
// نمی‌شود (وگرنه libass با bold مصنوعی رویش، بیش‌ازحد سنگین می‌شود)؛ بقیه‌ی خانواده‌ها (که هم
// وزن Regular هم Bold دارند) با فلگ Bold=-1 وزن Bold واقعی‌شان انتخاب می‌شود.
function boldFlagFor(fontFamily: string): number {
  return fontFamily === 'IRANYekanMsn ExtraBold' ? 0 : -1;
}

function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function msToAssTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// {} در ASS برای override tag رزرو شده و \ شروع‌کننده‌ی تگ است — متن خام کاربر (که این
// کاراکترها را ندارد معمولاً، ولی نباید کورکورانه اعتماد کرد) باید قبل از قرارگرفتن در فایل
// پاک‌سازی شود، وگرنه یک متن دست‌کاری‌شده می‌تواند در رندر تگ تزریق کند
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

// جابجایی آزاد با درگ (نه فقط ۳ حالت گسسته) — وقتی positionX/Y ست نشده، از position قدیمی
// (بالا/وسط/پایین) به‌عنوان fallback پروژه‌های قدیمی استفاده می‌شود
function resolvePositionRatio(style: CaptionStyleOverrides): { x: number; y: number } {
  const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
  if (typeof style.positionX === 'number' && typeof style.positionY === 'number') {
    return { x: clamp(style.positionX), y: clamp(style.positionY) };
  }
  const y = style.position === 'top' ? 0.12 : style.position === 'center' ? 0.5 : 0.88;
  return { x: 0.5, y };
}

// کلمات را با فاصله‌ی معمولی می‌چسباند، ولی هر wordsPerLine-امین مرز را با \N (شکست خط ASS)
// جدا می‌کند — همین یک مکانیزم هم «چند کلمه در هر خط» هم «چند خط هم‌زمان» را پیاده می‌کند
function joinWordsForDisplay(parts: string[], wordsPerLine: number): string {
  return parts.reduce((acc, cur, idx) => {
    if (idx === 0) return cur;
    const sep = idx % wordsPerLine === 0 ? '\\N' : ' ';
    return `${acc}${sep}${cur}`;
  }, '');
}

export function buildAssSubtitle(
  segments: CaptionSegment[],
  styleOverrides: CaptionStyleOverrides | null | undefined,
  videoWidth: number,
  videoHeight: number,
): string {
  const preset = STYLE_PRESETS[styleOverrides?.styleId ?? 'default'] ?? STYLE_PRESETS.default;
  const style: Required<CoreStyle> = {
    ...DEFAULT_STYLE,
    fontFamily: preset.fontFamily,
    textColor: preset.textColor,
    highlightColor: preset.highlightColor,
    backgroundMode: preset.backgroundMode ?? DEFAULT_STYLE.backgroundMode,
    ...(styleOverrides ?? {}),
  };
  const fontFamily = ALLOWED_FONTS.has(style.fontFamily) ? style.fontFamily : DEFAULT_STYLE.fontFamily;
  const wordsPerLine = style.wordsPerLine > 0 ? style.wordsPerLine : 4;

  const { x: posXRatio, y: posYRatio } = resolvePositionRatio(styleOverrides ?? {});
  const posX = Math.round(posXRatio * videoWidth);
  const posY = Math.round(posYRatio * videoHeight);

  const primaryColour = hexToAssColor(style.textColor);
  const highlightColour = hexToAssColor(style.highlightColor);
  const outlineColour = hexToAssColor(preset.outlineColorHex);
  // BorderStyle=3 یعنی جعبه‌ی پس‌زمینه‌ی توپر (به‌جای outline+shadow معمولی)؛ رنگ/شفافیتش از
  // BackColour می‌آید. 'none' یعنی بدون جعبه — BorderStyle=1 با outline نازک برای خوانایی.
  const useBox = style.backgroundMode !== 'none';
  const borderStyle = useBox ? 3 : 1;
  const backAlpha = style.backgroundMode === 'solid' ? '00' : '60'; // 00=توپر کامل، 60≈%62 شفافیت
  const backColour = hexToAssColor(preset.boxColorHex, backAlpha);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${style.fontSizePx},${primaryColour},&H000000FF,${outlineColour},${backColour},${boldFlagFor(fontFamily)},0,0,0,100,100,0,0,${borderStyle},${preset.outlineWidth},1,5,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const posTag = `{\\an5\\pos(${posX},${posY})}`;
  const dialogueLines: string[] = [];

  for (const segment of segments) {
    const words = segment.words ?? [];
    if (words.length === 0) {
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(segment.startMs)},${msToAssTime(segment.endMs)},Default,,0,0,0,,${posTag}${escapeAssText(segment.text)}`,
      );
      continue;
    }

    // هر کلمه یک Dialogue جدا می‌شود که از پایان کلمه‌ی قبلی تا شروع کلمه‌ی بعدی طول می‌کشد
    // (نه دقیقاً بازه‌ی خودش) — این‌طور کل خط پیوسته روی صفحه می‌ماند و فقط هایلایت جابه‌جا
    // می‌شود، بدون سوسوزدن بین کلمات (بخش ۵.۲/۸.۱)
    for (let i = 0; i < words.length; i++) {
      const startMs = i === 0 ? segment.startMs : Math.round(words[i].start * 1000);
      const endMs = i === words.length - 1 ? segment.endMs : Math.round(words[i + 1].start * 1000);
      if (endMs <= startMs) continue;

      const parts = words.map((w, idx) => {
        const safe = escapeAssText(w.word);
        return idx === i ? `{\\c${highlightColour}}${safe}{\\c${primaryColour}}` : safe;
      });
      const text = `${posTag}${joinWordsForDisplay(parts, wordsPerLine)}`;

      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(startMs)},${msToAssTime(endMs)},Default,,0,0,0,,${text}`,
      );
    }
  }

  return `${header}\n${dialogueLines.join('\n')}\n`;
}
