import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePort } from 'node:worker_threads';

export interface ExtractAudioTask {
  inputBuffer: Buffer;
  inputExt: string; // پسوند واقعی فایل ورودی (mp4, mov, ...) — فقط برای این‌که ffmpeg پسوند معتبر ببیند
}

export interface TranscodeVideoTask {
  inputBuffer: Buffer;
  inputExt: string;
}

export interface BurnCaptionsTask {
  inputBuffer: Buffer;
  inputExt: string;
  assContent: string; // متن کامل فایل .ass ساخته‌شده توسط ass-subtitle-builder.ts
  // اگر ست شده باشد (کوچک‌تر از ابعاد واقعی ورودی)، خروجی قبل از سوزاندن زیرنویس به این
  // ابعاد اسکیل می‌شود (گزینه‌ی HD/Full HD/4K در caption-render.processor.ts) — هر دو باید
  // زوج باشند (الزام libx264) و از قبل با PlayResX/Y فایل ASS یکی محاسبه شده باشند
  targetWidth?: number;
  targetHeight?: number;
  // مدت واقعی ویدیو (ثانیه) — برای محاسبه‌ی درصد پیشرفت از out_time خروجی ffmpeg -progress لازم است
  durationSec?: number;
  // پورت MessageChannel برای ارسال درصد پیشرفت به ترد اصلی (media-transcode.service.ts)؛
  // چون Piscina task data را با structured clone منتقل می‌کند، callback معمولی قابل عبور نیست
  progressPort?: MessagePort;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

// این فایل روی یک worker thread جدا اجرا می‌شود (از MediaTranscodeService، از طریق Piscina)
// — عمداً بدون هیچ وابستگی به NestJS/Redis/Prisma، دقیقاً مثل الگوی
// modules/usage/token-estimator.worker.ts. خودِ ffmpeg با child_process.spawn یک OS process
// کاملاً جداست، ولی نوشتن/خواندن فایل موقت و مدیریت خطا هم بهتر است از ترد اصلی Node دور بماند
// (docs/PRD-video-auto-captions.md §۱۶.۱/۱۶.۲).
async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`),
        );
    });
  });
}

// مثل runFfmpeg، فقط علاوه‌بر آن با `-progress pipe:1` خروجی ساختاریافته‌ی ffmpeg را از stdout
// می‌خواند و از خط‌های `out_time=HH:MM:SS.ms` درصد پیشرفت را حساب می‌کند (بخش پراگرس رندر
// caption-studio — قبلاً هیچ‌جا این خروجی parse نمی‌شد). فرمت out_time به‌مراتب پایدارتر از
// out_time_ms است (نام گمراه‌کننده‌ی همیشگی‌اش که در نسخه‌های مختلف ffmpeg واحدش عوض شده).
function runFfmpegWithProgress(
  args: string[],
  durationSec: number | undefined,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    let stdoutBuf = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (onProgress && durationSec && durationSec > 0) {
      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
          if (!match) continue;
          const outSec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          // تا ۹۹٪ — ۱۰۰٪ فقط بعد از resolve واقعی (موفقیت آپلود خروجی) در processor ست می‌شود
          const percent = Math.min(99, Math.max(0, Math.round((outSec / durationSec) * 100)));
          onProgress(percent);
        }
      });
    }
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`),
        );
    });
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nivo-media-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`ffprobe exited with code ${code}: ${stderr.slice(-1000)}`),
        );
    });
  });
}

// صدای mono ۱۶kHz در ۶۴kbps — کافی برای ASR (whisper و مشابه) و طبق docs/PRD-video-auto-captions.md
// §۱۰/§۱۶.۱ حتی برای سقف محصول ۲۰ دقیقه هم به‌مراتب زیر سقف ۲۵MB آپلود OpenRouter می‌ماند.
export async function extractAudio({
  inputBuffer,
  inputExt,
}: ExtractAudioTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const outPath = join(dir, `${randomUUID()}.mp3`);
    await writeFile(inPath, inputBuffer);
    await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      outPath,
    ]);
    return readFile(outPath);
  });
}

// نرمال‌سازی HEVC/.mov آیفون → H.264/.mp4 — سازگاری تضمین‌شده پیش از ارسال به هر provider
// (docs/PRD-video-auto-captions.md §۷ / docs/PRD-video-studio-editing.md §۷)
export async function transcodeVideo({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const outPath = join(dir, `${randomUUID()}.mp4`);
    await writeFile(inPath, inputBuffer);
    await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outPath,
    ]);
    return readFile(outPath);
  });
}

// لازم تا PlayResX/PlayResY فایل ASS با ابعاد واقعی ویدیو یکی باشد — وگرنه اندازه/موقعیت
// زیرنویس روی ویدیوی عمودی (۹:۱۶) اشتباه محاسبه می‌شود (docs/PRD-video-auto-captions.md §۵.۲)
//
// ویدیوهای موبایل (مخصوصاً آیفون در حالت عمودی) اغلب با ابعاد coded افقی ذخیره می‌شوند و فقط
// یک متادیتای چرخش (rotate tag قدیمی QuickTime یا Display Matrix جدید) دارند که پلیر/مرورگر
// موقع نمایش می‌چرخاندش. اگر همین عدد خام (width,height) بدون توجه به چرخش استفاده شود، هم
// canvas زیرنویس (PlayResX/Y) هم نسبت تصویر واقعی هنگام scale اشتباه محاسبه می‌شود و ویدیوی
// خروجی نسبت به سورس واقعی «کج»/با نسبت اشتباه از آب درمی‌آید — پس width/height باید بر اساس
// چرخش واقعی swap شوند تا با آنچه کاربر واقعاً می‌بیند یکی باشند.
export async function getVideoDimensions({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<VideoDimensions> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    await writeFile(inPath, inputBuffer);
    const out = await runFfprobe([
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,side_data_list:stream_tags=rotate',
      '-of',
      'json',
      inPath,
    ]);
    const parsed = JSON.parse(out) as {
      streams?: Array<{
        width?: number;
        height?: number;
        tags?: { rotate?: string };
        side_data_list?: Array<{ rotation?: number }>;
      }>;
    };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) {
      throw new Error(`could not determine video dimensions: "${out}"`);
    }
    let { width, height } = stream;
    const tagRotate = Number(stream.tags?.rotate ?? 0);
    const sideDataRotate = stream.side_data_list?.find(
      (d) => typeof d.rotation === 'number',
    )?.rotation;
    const rotation = ((tagRotate || sideDataRotate || 0) % 360 + 360) % 360;
    if (rotation === 90 || rotation === 270) {
      [width, height] = [height, width];
    }
    return { width, height };
  });
}

// docs/PRD-video-edit-omni-kie.md §۵.۴ — مدت واقعی ویدیوی آپلودی (نه فرض‌شده) لازم است هم
// برای preflight هزینه (بخش ۶.۵) هم برای اعتبارسنجی پنجره‌ی start/end حالت EDIT/GENERATE
export async function getVideoDuration({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<number> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    await writeFile(inPath, inputBuffer);
    const out = await runFfprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      inPath,
    ]);
    const duration = Number(out.trim());
    if (!duration || !isFinite(duration)) {
      throw new Error(`could not determine video duration: "${out}"`);
    }
    return duration;
  });
}

// سوزاندن زیرنویس روی ویدیو با ffmpeg + libass (فیلتر ass=) — بخش ۵.۱: چون خودِ فایل ASS
// از قبل native از کاراکاپ/رنگ/موقعیت پشتیبانی می‌کند، رندر فریم‌به‌فریم لازم نیست. صدای اصلی
// دست‌نخورده کپی می‌شود (-c:a copy)، فقط ویدیو دوباره انکود می‌شود (برای اعمال فیلتر زیرنویس).
export async function burnCaptions({
  inputBuffer,
  inputExt,
  assContent,
  targetWidth,
  targetHeight,
  durationSec,
  progressPort,
}: BurnCaptionsTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const assPath = join(dir, `${randomUUID()}.ass`);
    const outPath = join(dir, `${randomUUID()}.mp4`);
    await writeFile(inPath, inputBuffer);
    await writeFile(assPath, assContent, 'utf8');
    // اسکیل (اگر رزولوشن پایین‌تری درخواست شده) باید قبل از فیلتر ass= اعمال شود — PlayResX/Y
    // فایل ASS از قبل با همین targetWidth/targetHeight محاسبه شده (caption-render.processor.ts)
    const vf =
      targetWidth && targetHeight
        ? `scale=${targetWidth}:${targetHeight},ass=${assPath}`
        : `ass=${assPath}`;
    await runFfmpegWithProgress(
      [
        '-y',
        '-i',
        inPath,
        '-progress',
        'pipe:1',
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ],
      durationSec,
      progressPort ? (percent) => progressPort.postMessage(percent) : undefined,
    );
    return readFile(outPath);
  });
}
