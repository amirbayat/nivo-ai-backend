// docs/PRD-video-auto-captions.md §۵.۱/§۸.۱ — تبدیل segments (بخش ۶: cueهای ادیت‌شده‌ی
// کاربر) + styleOverrides به یک فایل .ass قابل‌مصرف توسط ffmpeg (فیلتر ass=، از طریق
// libass). عمداً یک تابع خالص (بدون وابستگی به NestJS/Prisma) — هم قابل unit-test مستقل،
// هم چون این فایل صرفاً روی داده‌ی JSON کار می‌کند، نه I/O.
//
// MVP فقط یک «انیمیشن» دارد: هایلایت کلمه‌ی جاری (رنگ برند) در میان بقیه‌ی کلمات (رنگ پیش‌فرض)
// — دقیقاً همان چیزی که در مکاپ طراحی (Main.dc.html) دیده می‌شود. قالب #۱ تا #۱۰ بخش ۸.۱
// (کاراکاپ زرد، نئون، پیل گرد و ...) فاز بعدی‌اند؛ اینجا فقط یک استایل واحد و کامل پیاده شده.

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
}

const WORDS_PER_SEGMENT = 4;

// اگر کاربر هیچ ادیتی نکرده باشد (segments هنوز null است)، همون گروه‌بندی ساده‌ی پیش‌فرض (هر
// ۴ کلمه یک cue) از transcriptWords ساخته می‌شود — کاربر نباید مجبور باشد قبل از اولین
// رندر/export حتماً دستی ادیت کند (docs/PRD-video-auto-captions.md §۳/§۵.۲). هم caption-render
// و هم export فایل خام (بخش ۸.۲) از همین تابع استفاده می‌کنند.
export function buildDefaultSegments(words: CaptionWord[]): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_SEGMENT) {
    const group = words.slice(i, i + WORDS_PER_SEGMENT);
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

// «Vazirmatn» (فونت وب nivo) هنوز داخل ایمیج داکر باندل نشده — libass از طریق fontconfig
// فقط فونتی را پیدا می‌کند که واقعاً روی سیستم نصب باشد. «Noto Naskh Arabic» تنها فونتی
// است که تست واقعی (۱۴۰۵-۰۶-۱۴، docs/PRD-video-auto-captions.md §۱۶) تأیید کرد روی
// node:22-alpine + apk نصب می‌شود و پوشش کامل حروف فارسی/عربی دارد. وقتی فونت برند واقعی
// در ایمیج باندل شد (فاز بعد)، این پیش‌فرض باید عوض شود.
const DEFAULT_STYLE: Required<CaptionStyleOverrides> = {
  fontFamily: 'Noto Naskh Arabic',
  textColor: '#FFFFFF',
  highlightColor: '#10B981', // برند امرالد nivo — همون رنگی که در پیش‌نمایش فرانت استفاده می‌شود
  backgroundMode: 'translucent',
  fontSizePx: 42,
  position: 'bottom',
};

const ALIGNMENT_BY_POSITION: Record<CaptionStyleOverrides['position'] & string, number> = {
  top: 8,
  center: 5,
  bottom: 2,
};

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
// کاراکترها را ندارد معمولاً، ولی نباید کورکورانه اعتماد کرد) باید qبل از قرارگرفتن در فایل
// پاک‌سازی شود، وگرنه یک متن دست‌کاری‌شده می‌تواند در رندر تگ تزریق کند
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

export function buildAssSubtitle(
  segments: CaptionSegment[],
  styleOverrides: CaptionStyleOverrides | null | undefined,
  videoWidth: number,
  videoHeight: number,
): string {
  const style = { ...DEFAULT_STYLE, ...(styleOverrides ?? {}) };
  const alignment = ALIGNMENT_BY_POSITION[style.position] ?? 2;

  const primaryColour = hexToAssColor(style.textColor);
  const highlightColour = hexToAssColor(style.highlightColor);
  // BorderStyle=3 یعنی جعبه‌ی پس‌زمینه‌ی توپر (به‌جای outline+shadow معمولی)؛ رنگ/شفافیتش از
  // BackColour می‌آید. 'none' یعنی بدون جعبه — BorderStyle=1 با outline نازک برای خوانایی.
  const useBox = style.backgroundMode !== 'none';
  const borderStyle = useBox ? 3 : 1;
  const backAlpha = style.backgroundMode === 'solid' ? '00' : '60'; // 00=توپر کامل، 60≈%62 شفافیت
  const backColour = hexToAssColor('#000000', backAlpha);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${style.fontSizePx},${primaryColour},&H000000FF,&H00000000,${backColour},-1,0,0,0,100,100,0,0,${borderStyle},2,1,${alignment},20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines: string[] = [];

  for (const segment of segments) {
    const words = segment.words ?? [];
    if (words.length === 0) {
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(segment.startMs)},${msToAssTime(segment.endMs)},Default,,0,0,0,,${escapeAssText(segment.text)}`,
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

      const text = words
        .map((w, idx) => {
          const safe = escapeAssText(w.word);
          return idx === i ? `{\\c${highlightColour}}${safe}{\\c${primaryColour}}` : safe;
        })
        .join(' ');

      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(startMs)},${msToAssTime(endMs)},Default,,0,0,0,,${text}`,
      );
    }
  }

  return `${header}\n${dialogueLines.join('\n')}\n`;
}
