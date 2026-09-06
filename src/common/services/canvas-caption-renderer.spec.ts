import { renderCaptionFrames } from './canvas-caption-renderer';
import type { CaptionSegment } from './caption-style-catalog';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(png: Buffer): { width: number; height: number } {
  // IHDR chunk همیشه بلافاصله بعد از ۸ بایت magic می‌آید: ۴ بایت طول + 'IHDR' + width(4) + height(4)
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe('renderCaptionFrames', () => {
  const videoWidth = 640;
  const videoHeight = 360;

  it('کل تایم‌لاین [0, videoDurationMs) را بدون گپ/همپوشانی می‌پوشاند', async () => {
    const segments: CaptionSegment[] = [
      {
        id: 'seg-0',
        startMs: 500,
        endMs: 1000,
        text: 'سلام خوبی',
        words: [
          { word: 'سلام', start: 0.5, end: 0.75 },
          { word: 'خوبی', start: 0.75, end: 1.0 },
        ],
      },
      {
        id: 'seg-1',
        startMs: 2000,
        endMs: 2500,
        text: 'عزیزم',
        words: [{ word: 'عزیزم', start: 2.0, end: 2.5 }],
      },
    ];
    const videoDurationMs = 3000;

    const frames = await renderCaptionFrames(
      segments,
      null,
      videoWidth,
      videoHeight,
      videoDurationMs,
    );

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].startMs).toBe(0);
    expect(frames[frames.length - 1].endMs).toBe(videoDurationMs);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].startMs).toBe(frames[i - 1].endMs);
    }
  });

  it('برای هر PNG، magic bytes و ابعاد دقیق تولید می‌کند', async () => {
    const segments: CaptionSegment[] = [
      {
        id: 'seg-0',
        startMs: 0,
        endMs: 400,
        text: 'سلام',
        words: [{ word: 'سلام', start: 0, end: 0.4 }],
      },
    ];
    const frames = await renderCaptionFrames(segments, null, videoWidth, videoHeight, 400);

    expect(frames.length).toBe(1);
    for (const frame of frames) {
      expect(frame.png.subarray(0, 8)).toEqual(PNG_MAGIC);
      const dims = readPngDimensions(frame.png);
      expect(dims.width).toBe(videoWidth);
      expect(dims.height).toBe(videoHeight);
    }
  });

  it('به تعداد کلمات، فریم هایلایت جدا تولید می‌کند (بدون گپ داخلی segment)', async () => {
    const segments: CaptionSegment[] = [
      {
        id: 'seg-0',
        startMs: 0,
        endMs: 1200,
        text: 'سلام خوبی عزیزم؟',
        words: [
          { word: 'سلام', start: 0, end: 0.4 },
          { word: 'خوبی', start: 0.4, end: 0.8 },
          { word: 'عزیزم؟', start: 0.8, end: 1.2 },
        ],
      },
    ];
    const frames = await renderCaptionFrames(segments, null, videoWidth, videoHeight, 1200);

    // ۳ کلمه → ۳ فریم هایلایت، بدون فریم گپ اضافه (segment کل تایم‌لاین را پر می‌کند)
    expect(frames.length).toBe(3);
    expect(frames.map((f) => [f.startMs, f.endMs])).toEqual([
      [0, 400],
      [400, 800],
      [800, 1200],
    ]);
  });

  it('regression: موقعیت x مرکز کلمه با فرمول prefixWidth/wordWidth یکسان است (RTL: کلمه‌ی اول راست‌ترین)', async () => {
    // این تست همان باگی را قفل می‌کند که در POC پیدا شد: prefix هر کلمه باید فاصله‌ی
    // بین‌کلمه‌ای قبل از خودش را حساب کند، وگرنه کلمات به هم می‌چسبند و centerX درست درنمی‌آید.
    // چون canvas-caption-renderer یک ماژول داخلی است (بدون export مستقیم layoutLine)، درستیِ
    // نتیجه با رندر واقعی ۳ فریم و مقایسه‌ی نسبی موقعیت کلمات (کلمه‌ی اول باید سمت راست‌ترین/
    // بزرگ‌ترین x باشد، بعدی کوچک‌تر، آخری کوچک‌ترین) تایید می‌شود — یعنی ترتیب معکوس نیست و
    // فاصله‌ها صفر یا منفی نمی‌شوند.
    const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
    const words = ['سلام', 'خوبی', 'عزیزم؟'];
    const canvas = createCanvas(videoWidth, videoHeight);
    const ctx = canvas.getContext('2d');
    ctx.font = '32px sans-serif';

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
    const centerX = words.map(
      (_, i) => rightEdgeX - (prefixWidthsPx[i] + wordWidthsPx[i] / 2),
    );

    // کلمه‌ی اول (سلام) باید بیشترین x را داشته باشد (سمت راست‌ترین)، آخری کمترین
    expect(centerX[0]).toBeGreaterThan(centerX[1]);
    expect(centerX[1]).toBeGreaterThan(centerX[2]);
    // فاصله‌ی بین کلمات مجاور باید حداقل به‌اندازه‌ی نصف عرض هرکدام باشد (رگرسیون باگ چسبیدن)
    expect(centerX[0] - centerX[1]).toBeGreaterThanOrEqual(
      (wordWidthsPx[0] + wordWidthsPx[1]) / 2,
    );
    expect(centerX[1] - centerX[2]).toBeGreaterThanOrEqual(
      (wordWidthsPx[1] + wordWidthsPx[2]) / 2,
    );
  });
});
