import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as HB from 'harfbuzzjs';
import { FONT_FILES, FONTS_DIR } from './caption-style-catalog';

// harfbuzzjs یک پکیج ESM-only است (بدون خروجی CommonJS) در حالی‌که خروجی کامپایل این پروژه
// CJS است (tsconfig: module=nodenext ولی package.json ریشه بدون "type":"module") — یعنی
// require('harfbuzzjs') مستقیم با ERR_REQUIRE_ESM شکست می‌خورد. راه‌حل: dynamic import (که
// در فایل CJS هم کار می‌کند)، فقط یک‌بار cache شده. همین باعث می‌شود توابع این فایل (و در
// نتیجه buildAssSubtitle) async باشند.
let hbModulePromise: Promise<typeof HB> | undefined;
function loadHarfbuzz(): Promise<typeof HB> {
  if (!hbModulePromise) hbModulePromise = import('harfbuzzjs');
  return hbModulePromise;
}

// اندازه‌گیری پیکسلی دقیق عرض کلمات فارسی/عربی با HarfBuzz (همان موتور shaping که واقعی
// در فونت‌ها اتصال/عرض حروف را حساب می‌کند) — لازم برای موقعیت‌دهی لایه‌ی هایلایت کلمه‌به‌کلمه
// در ass-subtitle-builder.ts (بخش RTL). بدون این، تنها راه «بستن یک کلمه در وسط خط با تگ
// رنگ» است که در تست عملی (رندر واقعی با ffmpeg/libass روی همین ایمیج) ترتیب کلمات RTL را
// به‌هم می‌ریخت (هر override tag وسط متن خط را به چند «run» می‌شکند و libass ترتیب داخل هر
// run را برعکس رندر می‌کند) — راه‌حل: خط پایه بدون هیچ تگی (تک‌run، تست‌شده که درست است) +
// یک Dialogue جدا فقط برای کلمه‌ی هایلایت‌شده، با \pos محاسبه‌شده از همین ماژول.
//
// نکته‌ی کالیبراسیون مهم: ASS «Fontsize» با واحد em (unitsPerEm فونت) یک‌به‌یک نیست — طبق
// تست عملی (رندر واقعی + اندازه‌گیری پیکسلی خروجی PNG با imagemagick trim، در مقابل همین
// محاسبه)، libass طوری مقیاس می‌کند که (ascender - descender) فونت برابر Fontsize شود، نه
// unitsPerEm. ضریب scale پایین دقیقاً همین رابطه را پیاده می‌کند؛ بدون آن هر عدد تقریباً ۱.۷
// برابر مقدار واقعی درمی‌آمد.

interface LoadedFont {
  font: HB.Font;
  scale: number; // ضرب در fontSizePx می‌شود تا واحد font-units به پیکسل تبدیل شود
}

const fontCache = new Map<string, LoadedFont>();

async function loadFont(
  fontFamily: string,
  bold: boolean,
): Promise<LoadedFont> {
  const cacheKey = `${fontFamily}:${bold ? 'bold' : 'regular'}`;
  const cached = fontCache.get(cacheKey);
  if (cached) return cached;

  const hb = await loadHarfbuzz();
  const files = FONT_FILES[fontFamily] ?? FONT_FILES['Noto Naskh Arabic'];
  const fileName = bold ? files.bold : files.regular;
  const bytes = readFileSync(join(FONTS_DIR, fileName));
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  const extents = font.hExtents();
  const scale = 1 / (extents.ascender - extents.descender);

  const loaded: LoadedFont = { font, scale };
  fontCache.set(cacheKey, loaded);
  return loaded;
}

async function shapeAdvances(
  text: string,
  font: HB.Font,
): Promise<{ cluster: number; xAdvance: number }[]> {
  const hb = await loadHarfbuzz();
  const buffer = new hb.Buffer();
  buffer.addText(text);
  // guessSegmentProperties (نه setDirection/setScript/setLanguage دستی) — تست عملی نشان داد
  // ست‌کردن دستی این سه‌تا باعث می‌شد hb.shape همه‌ی گلیف‌ها را .notdef با عرض صفر برگرداند.
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  return infos.map((info, i) => ({
    cluster: info.cluster,
    xAdvance: positions[i].xAdvance,
  }));
}

export interface LineMeasurement {
  totalWidthPx: number;
  /** عرض هر کلمه، هم‌ترتیب با آرایه‌ی ورودی words */
  wordWidthsPx: number[];
  /**
   * عرض متنِ «قبل از» هر کلمه در همین خط (بر اساس ترتیب منطقی/RTL رشته، نه چیدمان بصری) —
   * چون کلمه‌ی اول رشته در RTL سمت راست‌ترین است، این یعنی «فاصله از لبه‌ی راست خط تا لبه‌ی
   * راست این کلمه».
   */
  prefixWidthsPx: number[];
}

// یک خط را یک‌بار کامل shape می‌کند (نه هر کلمه را جدا) تا رفتار طبیعی فاصله‌گذاری/اتصال
// حروف بین کلمات هم لحاظ شود، بعد بر اساس cluster (ایندکس کاراکتر در رشته‌ی مبدأ) عرض هر
// کلمه و پیشوندش را از دل همان یک shape جدا می‌کند.
export async function measureLine(
  words: string[],
  fontFamily: string,
  bold: boolean,
  fontSizePx: number,
): Promise<LineMeasurement> {
  const { font, scale } = await loadFont(fontFamily, bold);
  const pxPerUnit = scale * fontSizePx;

  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  let lineText = '';
  for (const word of words) {
    if (cursor > 0) {
      lineText += ' ';
      cursor += 1;
    }
    const start = cursor;
    lineText += word;
    cursor += word.length;
    ranges.push({ start, end: cursor });
  }

  const glyphs = await shapeAdvances(lineText, font);
  const wordWidthsUnits = new Array(words.length).fill(0);
  const prefixWidthsUnits = new Array(words.length).fill(0);

  for (const g of glyphs) {
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i];
      if (g.cluster >= start && g.cluster < end) {
        wordWidthsUnits[i] += g.xAdvance;
      } else if (g.cluster < start) {
        prefixWidthsUnits[i] += g.xAdvance;
      }
    }
  }

  const totalWidthUnits = glyphs.reduce((sum, g) => sum + g.xAdvance, 0);

  return {
    totalWidthPx: totalWidthUnits * pxPerUnit,
    wordWidthsPx: wordWidthsUnits.map((w) => w * pxPerUnit),
    prefixWidthsPx: prefixWidthsUnits.map((w) => w * pxPerUnit),
  };
}
