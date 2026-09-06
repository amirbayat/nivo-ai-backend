// اسکریپت تشخیص باگ: چک می‌کند که آیا burnCaptions واقعی (خط تولید) ویدیوی عمودی
// (چرخش ۹۰ درجه side-data، مثل ویدیوهای گوشی) را درست پردازش می‌کند یا به افقی تبدیلش می‌کند.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { burnCaptions } from '../../src/common/services/media-transcode.worker';
import { getVideoDimensions } from '../../src/common/services/media-transcode.worker';
import type { CaptionSegment } from '../../src/common/services/caption-style-catalog';

const OUT_DIR = join(__dirname, 'scratch-rotation');
mkdirSync(OUT_DIR, { recursive: true });

const inputPath = '/private/tmp/rot-test/vertical_phone.mp4';

const segments: CaptionSegment[] = [
  {
    id: 'seg-0',
    startMs: 0,
    endMs: 1000,
    text: 'تست چرخش',
    words: [
      { word: 'تست', start: 0, end: 0.5 },
      { word: 'چرخش', start: 0.5, end: 1.0 },
    ],
  },
];

async function main() {
  const inputBuffer = readFileSync(inputPath);
  const dims = await getVideoDimensions({ inputBuffer, inputExt: 'mp4' });
  console.log('getVideoDimensions (rotation-corrected):', dims);

  const result = await burnCaptions({
    inputBuffer,
    inputExt: 'mp4',
    segments,
    styleOverrides: { styleId: 'boldOutline' },
    videoDurationMs: 2000,
    outputWidth: dims.width,
    outputHeight: dims.height,
    durationSec: 2,
  });

  const outPath = join(OUT_DIR, 'out.mp4');
  writeFileSync(outPath, result);
  console.log('wrote', outPath, result.length, 'bytes');

  const probe = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    outPath,
  ]).toString();
  console.log('output ffprobe:', probe);

  execFileSync('ffmpeg', [
    '-y', '-ss', '0.5', '-i', outPath, '-frames:v', '1', '-update', '1',
    join(OUT_DIR, 'frame.png'),
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
