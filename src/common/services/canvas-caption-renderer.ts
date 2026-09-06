// جایگزین رندر burn-in بر پایه‌ی ASS/libass: به‌جای Dialogueهای stacked (ass-subtitle-builder.ts)،
// به‌ازای هر «state» هایلایت (هر کلمه) یک فریم PNG شفاف کامل رندر می‌شود — layout (موقعیت هر
// کلمه) فقط یک‌بار به‌ازای هر خط محاسبه می‌شود و بین stateها فقط رنگ عوض می‌شود، نه موقعیت. چون
// هر کلمه یک fillText کاملاً مستقل با موقعیت از‌پیش‌محاسبه‌شده است (نه یک تگ رنگ وسط یک رشته‌ی
// واحد)، باگ به‌هم‌ریختن ترتیب RTL که در ass-subtitle-builder.ts (کامنت خط ۱۸-۲۲ همان‌جا) با آن
// دست‌وپنجه نرم می‌شد اینجا اصلاً رخ نمی‌دهد.
//
// خروجی این ماژول را media-transcode.worker.ts با ffmpeg concat demuxer به یک ویدیوی آلفای
// جدا تبدیل می‌کند و در یک پاس overlay روی ویدیوی اصلی می‌نشاند (به‌جای زنجیر صدها فیلتر
// overlay، یکی به‌ازای هر کلمه، که مقیاس‌پذیر نیست).

import { GlobalFonts, createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { join } from 'node:path';
import {
  ALLOWED_FONTS,
  DEFAULT_STYLE,
  FONT_FILES,
  FONTS_DIR,
  STYLE_PRESETS,
  boldFlagFor,
  computeWordHighlightIntervals,
  resolvePositionRatio,
  type CaptionSegment,
  type CaptionStyleOverrides,
  type CoreStyle,
} from './caption-style-catalog';

export interface CaptionFrame {
  /** RGBA PNG به ابعاد دقیق videoWidth x videoHeight */
  png: Buffer;
  startMs: number;
  endMs: number;
}

// ضریب کالیبراسیون اندازه‌ی فونت: مقادیر fontSizePx ذخیره‌شده در DB قبلاً فقط برای ASS/libass
// کالیبره شده بودند (طبق text-shaping.ts: libass طوری مقیاس می‌کند که ascender-descender فونت
// برابر Fontsize شود، نه unitsPerEm — تقریباً ۱.۷ برابر تفاوت). ctx.font با معنای معمول
// CSS-pixel کار می‌کند، پس بدون این ضریب، بعد از cutover همه‌ی پروژه‌های موجود ناگهان با
// سایز دیداری متفاوتی رندر می‌شوند. مقدار دقیق باید طی کالیبراسیون چشمی/پیکسلی در برابر خروجی
// واقعی ASS تنظیم شود (پلن migration، بخش verification) — این فقط نقطه‌ی شروع است.
const FONT_SIZE_CALIBRATION = 1.7;

const registeredFontPaths = new Set<string>();

function registerFontIfNeeded(fontFamily: string, bold: boolean): string {
  const files = FONT_FILES[fontFamily] ?? FONT_FILES['Noto Naskh Arabic'];
  const fileName = bold ? files.bold : files.regular;
  const alias = `${fontFamily}::${bold ? 'bold' : 'regular'}`;
  const path = join(FONTS_DIR, fileName);
  const cacheKey = `${path}::${alias}`;
  if (!registeredFontPaths.has(cacheKey)) {
    GlobalFonts.registerFromPath(path, alias);
    registeredFontPaths.add(cacheKey);
  }
  return alias;
}

interface ResolvedStyle {
  fontAlias: string;
  fontSizePx: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundMode: 'none' | 'translucent' | 'solid';
  boxColor: string;
  wordsPerLine: number;
  posX: number;
  posY: number;
  lineHeightPx: number;
}

function resolveStyle(
  styleOverrides: CaptionStyleOverrides | null | undefined,
  videoWidth: number,
  videoHeight: number,
): ResolvedStyle {
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
  const bold = boldFlagFor(fontFamily) !== 0;
  const fontAlias = registerFontIfNeeded(fontFamily, bold);
  const wordsPerLine = style.wordsPerLine > 0 ? style.wordsPerLine : 4;

  const { x: posXRatio, y: posYRatio } = resolvePositionRatio(
    styleOverrides ?? {},
  );

  return {
    fontAlias,
    fontSizePx: Math.round(style.fontSizePx * FONT_SIZE_CALIBRATION),
    textColor: style.textColor,
    highlightColor: style.highlightColor,
    outlineColor: preset.outlineColorHex,
    outlineWidth: preset.outlineWidth,
    backgroundMode: style.backgroundMode,
    boxColor: preset.boxColorHex,
    wordsPerLine,
    posX: Math.round(posXRatio * videoWidth),
    posY: Math.round(posYRatio * videoHeight),
    lineHeightPx: Math.round(style.fontSizePx * FONT_SIZE_CALIBRATION),
  };
}

interface LineLayout {
  words: string[];
  wordCenterX: number[];
  totalWidthPx: number;
}

// درست مثل الگوریتم text-shaping.ts (کلمه‌ی اول رشته سمت راست‌ترین است) ولی با ctx.measureText
// به‌جای HarfBuzz. نکته‌ی مهم: prefix هر کلمه باید فاصله‌ی بین‌کلمه‌ای را که قبلش می‌آید حساب
// کند، وگرنه کلمات به هم می‌چسبند (باگ واقعی که در POC پیدا و فیکس شد).
function layoutLine(ctx: SKRSContext2D, words: string[]): LineLayout {
  const fullLine = words.join(' ');
  const totalWidthPx = ctx.measureText(fullLine).width;

  let cursor = '';
  const prefixWidthsPx: number[] = [];
  const wordWidthsPx: number[] = [];
  for (let i = 0; i < words.length; i++) {
    prefixWidthsPx.push(ctx.measureText(cursor).width);
    wordWidthsPx.push(ctx.measureText(words[i]).width);
    cursor += words[i] + (i < words.length - 1 ? ' ' : '');
  }

  const rightEdgeX = totalWidthPx / 2;
  const wordCenterX = words.map(
    (_, i) => rightEdgeX - (prefixWidthsPx[i] + wordWidthsPx[i] / 2),
  );

  return { words, wordCenterX, totalWidthPx };
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// جعبه‌ی پس‌زمینه‌ی کل بلوک متن (چندخطی) وقتی backgroundMode !== 'none' — پدینگ حدسی
// (۰.۲۵×fontSizePx)، چون padding داخلی BorderStyle=3 خود libass مستقیم قابل‌portable نیست
// (نیاز به تنظیم چشمی، طبق پلن migration، بخش کالیبراسیون).
function drawBackgroundBox(
  ctx: SKRSContext2D,
  lineLayouts: LineLayout[],
  centerX: number,
  centerY: number,
  style: ResolvedStyle,
): void {
  if (style.backgroundMode === 'none') return;
  const maxWidth = Math.max(...lineLayouts.map((l) => l.totalWidthPx));
  const numLines = lineLayouts.length;
  const padding = style.fontSizePx * 0.25;
  const boxWidth = maxWidth + padding * 2;
  const boxHeight = numLines * style.lineHeightPx + padding * 2;
  const alpha = style.backgroundMode === 'solid' ? 1 : 0.62;
  ctx.fillStyle = hexToRgba(style.boxColor, alpha);
  ctx.fillRect(
    centerX - boxWidth / 2,
    centerY - boxHeight / 2,
    boxWidth,
    boxHeight,
  );
}

function drawLine(
  ctx: SKRSContext2D,
  layout: LineLayout,
  activeWordIndex: number | null,
  centerX: number,
  y: number,
  style: ResolvedStyle,
): void {
  layout.words.forEach((word, i) => {
    const x = centerX + layout.wordCenterX[i];
    const color = i === activeWordIndex ? style.highlightColor : style.textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(2, Math.round(style.outlineWidth));
    ctx.shadowOffsetY = 2;
    ctx.lineWidth = style.outlineWidth * 2;
    ctx.strokeStyle = style.outlineColor;
    ctx.strokeText(word, x, y);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color;
    ctx.fillText(word, x, y);
  });
}

function makeContext(
  width: number,
  height: number,
  style: ResolvedStyle,
): SKRSContext2D {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${style.fontSizePx}px "${style.fontAlias}"`;
  ctx.lineJoin = 'round';
  return ctx;
}

function toPngBuffer(ctx: SKRSContext2D): Buffer {
  return ctx.canvas.toBuffer('image/png');
}

let blankFramePngCache: { width: number; height: number; png: Buffer } | null =
  null;

function blankFramePng(width: number, height: number): Buffer {
  if (
    blankFramePngCache &&
    blankFramePngCache.width === width &&
    blankFramePngCache.height === height
  ) {
    return blankFramePngCache.png;
  }
  const canvas = createCanvas(width, height);
  const png = canvas.toBuffer('image/png');
  blankFramePngCache = { width, height, png };
  return png;
}

export async function renderCaptionFrames(
  segments: CaptionSegment[],
  styleOverrides: CaptionStyleOverrides | null | undefined,
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number,
): Promise<CaptionFrame[]> {
  const style = resolveStyle(styleOverrides, videoWidth, videoHeight);
  const frames: CaptionFrame[] = [];
  let cursorMs = 0;

  const pushGapIfNeeded = (untilMs: number) => {
    if (untilMs > cursorMs) {
      frames.push({
        png: blankFramePng(videoWidth, videoHeight),
        startMs: cursorMs,
        endMs: untilMs,
      });
      cursorMs = untilMs;
    }
  };

  for (const segment of segments) {
    const words = (segment.words ?? []).map((w) => w.word.trim());
    pushGapIfNeeded(segment.startMs);

    if (words.length === 0) {
      const ctx = makeContext(videoWidth, videoHeight, style);
      const layout = layoutLine(ctx, [segment.text.trim()]);
      drawBackgroundBox(ctx, [layout], style.posX, style.posY, style);
      drawLine(ctx, layout, null, style.posX, style.posY, style);
      frames.push({
        png: toPngBuffer(ctx),
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
      cursorMs = segment.endMs;
      continue;
    }

    const lines: string[][] = [];
    for (let i = 0; i < words.length; i += style.wordsPerLine) {
      lines.push(words.slice(i, i + style.wordsPerLine));
    }
    const numLines = lines.length;

    const lineLayouts = lines.map((lineWords) => {
      const ctx = makeContext(videoWidth, videoHeight, style);
      return layoutLine(ctx, lineWords);
    });

    for (const { wordIndex, startMs, endMs } of computeWordHighlightIntervals(
      segment,
    )) {
      pushGapIfNeeded(startMs);

      const lineIdx = Math.floor(wordIndex / style.wordsPerLine);
      const idxInLine = wordIndex % style.wordsPerLine;
      const ctx = makeContext(videoWidth, videoHeight, style);
      drawBackgroundBox(ctx, lineLayouts, style.posX, style.posY, style);
      lines.forEach((lineWords, li) => {
        const y = Math.round(
          style.posY + (li - (numLines - 1) / 2) * style.lineHeightPx,
        );
        drawLine(
          ctx,
          lineLayouts[li],
          li === lineIdx ? idxInLine : null,
          style.posX,
          y,
          style,
        );
      });

      frames.push({ png: toPngBuffer(ctx), startMs, endMs });
      cursorMs = endMs;
    }

    pushGapIfNeeded(segment.endMs);
  }

  pushGapIfNeeded(videoDurationMs);
  return frames;
}
