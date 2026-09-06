// docs/PRD-video-auto-captions.md §۵.۱/§۸.۱ — تبدیل segments (بخش ۶: cueهای ادیت‌شده‌ی
// کاربر) + styleOverrides به یک فایل .ass قابل‌مصرف توسط ffmpeg (فیلتر ass=، از طریق
// libass). عمداً بدون وابستگی به NestJS/Prisma (قابل unit-test مستقل) — ولی دیگر کاملاً
// «بدون I/O» نیست: برای موقعیت‌دهی پیکسلی هایلایت کلمه‌به‌کلمه (پایین‌تر) از text-shaping.ts
// استفاده می‌کند که فایل فونت را از دیسک می‌خواند (cache شده، فقط یک‌بار به‌ازای هر فونت).

import { measureLine } from './text-shaping';
import {
  ALLOWED_FONTS,
  DEFAULT_STYLE,
  STYLE_PRESETS,
  boldFlagFor,
  computeWordHighlightIntervals,
  resolvePositionRatio,
  type CaptionSegment,
  type CaptionStyleOverrides,
  type CoreStyle,
} from './caption-style-catalog';

export type {
  CaptionWord,
  CaptionSegment,
  CaptionStyleOverrides,
} from './caption-style-catalog';
export { buildDefaultSegments } from './caption-style-catalog';

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

export async function buildAssSubtitle(
  segments: CaptionSegment[],
  styleOverrides: CaptionStyleOverrides | null | undefined,
  videoWidth: number,
  videoHeight: number,
): Promise<string> {
  const preset =
    STYLE_PRESETS[styleOverrides?.styleId ?? 'default'] ??
    STYLE_PRESETS.default;
  const style: Required<CoreStyle> = {
    ...DEFAULT_STYLE,
    fontFamily: preset.fontFamily,
    textColor: preset.textColor,
    highlightColor: preset.highlightColor,
    backgroundMode: preset.backgroundMode ?? DEFAULT_STYLE.backgroundMode,
    ...(styleOverrides ?? {}),
  };
  const fontFamily = ALLOWED_FONTS.has(style.fontFamily)
    ? style.fontFamily
    : DEFAULT_STYLE.fontFamily;
  const wordsPerLine = style.wordsPerLine > 0 ? style.wordsPerLine : 4;

  const { x: posXRatio, y: posYRatio } = resolvePositionRatio(
    styleOverrides ?? {},
  );
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

  // استایل «Highlight» عمداً BorderStyle=1 (بدون جعبه) دارد، حتی وقتی preset اصلی
  // backgroundMode='solid'/'translucent' باشد — چون لایه‌ی هایلایت یک Dialogue جدا برای
  // همان یک کلمه است (پایین‌تر)؛ اگر BorderStyle آن هم ۳ می‌بود، یک جعبه‌ی کوچک اضافه دقیقاً
  // زیر همان کلمه رسم می‌شد، روی جعبه‌ی کاملِ خط که لایه‌ی پایه از قبل کشیده — یعنی یک
  // نواردوتایی/ضخیم‌تر فقط زیر کلمه‌ی هایلایت. BackColour آن هم بی‌اهمیت است (چون
  // BorderStyle=1 اصلاً جعبه رسم نمی‌کند) ولی برای وضوح alpha=FF (کاملاً شفاف) گذاشته شده.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${style.fontSizePx},${primaryColour},&H000000FF,${outlineColour},${backColour},${boldFlagFor(fontFamily)},0,0,0,100,100,0,0,${borderStyle},${preset.outlineWidth},1,5,20,20,40,1
Style: Highlight,${fontFamily},${style.fontSizePx},${highlightColour},&H000000FF,${outlineColour},&HFF000000,${boldFlagFor(fontFamily)},0,0,0,100,100,0,0,1,${preset.outlineWidth},1,5,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const posTag = `{\\an5\\pos(${posX},${posY})}`;
  const dialogueLines: string[] = [];
  const bold = boldFlagFor(fontFamily) !== 0;
  // طبق تست عملی (رندر واقعی + اندازه‌گیری پیکسلی)، «فاصله‌ی عمودی بین دو خط» تقریباً برابر
  // خودِ Fontsize است (چون Fontsize از قبل طوری کالیبره شده که با ascender-descender فونت
  // برابر باشد — همان توضیح text-shaping.ts) — این فرمول فقط برای حالت تک‌خط (پیش‌فرض،
  // linesPerCue=1) واقعاً تست‌شده؛ برای cueهای چندخطی یک تقریب معقول است، نه پیکسل-دقیق.
  const lineHeightPx = style.fontSizePx;

  for (const segment of segments) {
    const words = segment.words ?? [];
    if (words.length === 0) {
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(segment.startMs)},${msToAssTime(segment.endMs)},Default,,0,0,0,,${posTag}${escapeAssText(segment.text)}`,
      );
      continue;
    }

    // خط پایه: یک Dialogue واحد برای کل بازه‌ی segment، شامل همه‌ی کلمات با رنگ عادی —
    // عمداً بدون هیچ override tag میان‌متنی (تک-run) چون تست عملی نشان داد libass با هر
    // تگی که وسط متن یک خط را بشکند، ترتیب کلمات RTL را به‌هم می‌ریزد (اجزای قبل/بعد تگ را
    // به‌شکل معکوس داخل خودشان رندر می‌کند). هایلایت کلمه‌به‌کلمه به‌جای تگ رنگ وسط متن، با
    // یک Dialogue کاملاً جدا (پایین‌تر) پیاده می‌شود که همان یک کلمه را با \pos محاسبه‌شده
    // دقیقاً روی جای خودش می‌کارد.
    const escapedWords = words.map((w) => escapeAssText(w.word.trim()));
    const lines: string[][] = [];
    for (let i = 0; i < escapedWords.length; i += wordsPerLine) {
      lines.push(escapedWords.slice(i, i + wordsPerLine));
    }
    const baseText = lines.map((line) => line.join(' ')).join('\\N');
    dialogueLines.push(
      `Dialogue: 0,${msToAssTime(segment.startMs)},${msToAssTime(segment.endMs)},Default,,0,0,0,,${posTag}${baseText}`,
    );

    // هایلایت: هر کلمه یک Dialogue جدا می‌شود که از پایان کلمه‌ی قبلی تا شروع کلمه‌ی بعدی
    // طول می‌کشد (نه دقیقاً بازه‌ی خودش) — این‌طور بدون سوسوزدن بین کلمات هایلایت جابه‌جا
    // می‌شود (بخش ۵.۲/۸.۱)
    const lineMeasurements = new Map<
      number,
      Awaited<ReturnType<typeof measureLine>>
    >();
    for (const { wordIndex: i, startMs, endMs } of computeWordHighlightIntervals(
      segment,
    )) {
      const lineIdx = Math.floor(i / wordsPerLine);
      const idxInLine = i % wordsPerLine;
      let measurement = lineMeasurements.get(lineIdx);
      if (!measurement) {
        measurement = await measureLine(
          lines[lineIdx],
          fontFamily,
          bold,
          style.fontSizePx,
        );
        lineMeasurements.set(lineIdx, measurement);
      }

      // RTL: کلمه‌ی اول رشته سمت راست‌ترین است — پس فاصله از لبه‌ی راست خط تا لبه‌ی راست
      // این کلمه = prefixWidth، و مرکز کلمه از لبه‌ی راست خط = prefixWidth + نصف عرض خودش
      const lineRightEdgeX = posX + measurement.totalWidthPx / 2;
      const wordCenterFromRightEdge =
        measurement.prefixWidthsPx[idxInLine] +
        measurement.wordWidthsPx[idxInLine] / 2;
      const overlayX = Math.round(lineRightEdgeX - wordCenterFromRightEdge);
      const numLines = lines.length;
      const overlayY = Math.round(
        posY + (lineIdx - (numLines - 1) / 2) * lineHeightPx,
      );

      const overlayTag = `{\\an5\\pos(${overlayX},${overlayY})}`;
      dialogueLines.push(
        `Dialogue: 1,${msToAssTime(startMs)},${msToAssTime(endMs)},Highlight,,0,0,0,,${overlayTag}${escapedWords[i]}`,
      );
    }
  }

  return `${header}\n${dialogueLines.join('\n')}\n`;
}
