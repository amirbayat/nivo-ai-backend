// اسکریپت دستی تأیید (ad-hoc، خارج از CI) — پایپ‌لاین burnCaptions واقعی (دوپاسی، ffmpeg
// concat + overlay) را روی چند fixture واقعی اجرا می‌کند و خروجی را برای بازرسی چشمی/ffprobe
// در scratch/ می‌گذارد. طبق پلن migration، بخش Verification.
//
// اجرا: npx ts-node -r tsconfig-paths/register scripts/manual/verify-caption-burn.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { burnCaptions } from '../../src/common/services/media-transcode.worker';
import type { CaptionSegment } from '../../src/common/services/caption-style-catalog';

const OUT_DIR = join(__dirname, 'scratch');
mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 1280;
const HEIGHT = 720;
const DURATION_SEC = 3;

function makeBaseVideo(path: string) {
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${WIDTH}x${HEIGHT}:rate=30:duration=${DURATION_SEC}`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

const segments: CaptionSegment[] = [
  {
    id: 'seg-0',
    startMs: 200,
    endMs: 1400,
    text: 'سلام خوبی عزیزم؟',
    words: [
      { word: 'سلام', start: 0.2, end: 0.6 },
      { word: 'خوبی', start: 0.6, end: 1.0 },
      { word: 'عزیزم؟', start: 1.0, end: 1.4 },
    ],
  },
  {
    id: 'seg-1',
    startMs: 1800,
    endMs: 2800,
    text: 'این یک تست کپشن است',
    words: [
      { word: 'این', start: 1.8, end: 2.05 },
      { word: 'یک', start: 2.05, end: 2.3 },
      { word: 'تست', start: 2.3, end: 2.55 },
      { word: 'کپشن', start: 2.55, end: 2.8 },
    ],
  },
];

async function main() {
  const basePath = join(OUT_DIR, 'base.mp4');
  makeBaseVideo(basePath);
  const inputBuffer = require('node:fs').readFileSync(basePath) as Buffer;

  const presets = ['default', 'boldOutline', 'neon', 'speakerBox'];
  for (const styleId of presets) {
    console.log(`--- rendering preset: ${styleId} ---`);
    const t0 = Date.now();
    const result = await burnCaptions({
      inputBuffer,
      inputExt: 'mp4',
      segments,
      styleOverrides: { styleId },
      videoDurationMs: DURATION_SEC * 1000,
      outputWidth: WIDTH,
      outputHeight: HEIGHT,
      durationSec: DURATION_SEC,
    });
    const outPath = join(OUT_DIR, `out-${styleId}.mp4`);
    writeFileSync(outPath, result);
    console.log(`wrote ${outPath} (${result.length} bytes) in ${Date.now() - t0}ms`);

    const probe = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      outPath,
    ]).toString();
    console.log('ffprobe:', probe.replace(/\s+/g, ' '));

    // فریم‌هایی در لحظه‌ی هایلایت هر کلمه/segment استخراج کن برای بازرسی چشمی
    for (const t of [0.4, 0.8, 1.2, 2.0, 2.4, 2.7]) {
      const framePath = join(OUT_DIR, `frame-${styleId}-${t}.png`);
      execFileSync('ffmpeg', [
        '-y',
        '-ss',
        String(t),
        '-i',
        outPath,
        '-frames:v',
        '1',
        '-update',
        '1',
        framePath,
      ]);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
