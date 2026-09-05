import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
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
      else reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

// صدای mono ۱۶kHz در ۶۴kbps — کافی برای ASR (whisper و مشابه) و طبق docs/PRD-video-auto-captions.md
// §۱۰/§۱۶.۱ حتی برای سقف محصول ۲۰ دقیقه هم به‌مراتب زیر سقف ۲۵MB آپلود OpenRouter می‌ماند.
export async function extractAudio({ inputBuffer, inputExt }: ExtractAudioTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const outPath = join(dir, `${randomUUID()}.mp3`);
    await writeFile(inPath, inputBuffer);
    await runFfmpeg(['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', outPath]);
    return readFile(outPath);
  });
}

// نرمال‌سازی HEVC/.mov آیفون → H.264/.mp4 — سازگاری تضمین‌شده پیش از ارسال به هر provider
// (docs/PRD-video-auto-captions.md §۷ / docs/PRD-video-studio-editing.md §۷)
export async function transcodeVideo({ inputBuffer, inputExt }: TranscodeVideoTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const outPath = join(dir, `${randomUUID()}.mp4`);
    await writeFile(inPath, inputBuffer);
    await runFfmpeg([
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-movflags', '+faststart',
      outPath,
    ]);
    return readFile(outPath);
  });
}

// لازم تا PlayResX/PlayResY فایل ASS با ابعاد واقعی ویدیو یکی باشد — وگرنه اندازه/موقعیت
// زیرنویس روی ویدیوی عمودی (۹:۱۶) اشتباه محاسبه می‌شود (docs/PRD-video-auto-captions.md §۵.۲)
export async function getVideoDimensions({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<VideoDimensions> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    await writeFile(inPath, inputBuffer);
    const out = await runFfprobe([
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      inPath,
    ]);
    const [width, height] = out.trim().split(',').map(Number);
    if (!width || !height) throw new Error(`could not determine video dimensions: "${out}"`);
    return { width, height };
  });
}

// سوزاندن زیرنویس روی ویدیو با ffmpeg + libass (فیلتر ass=) — بخش ۵.۱: چون خودِ فایل ASS
// از قبل native از کاراکاپ/رنگ/موقعیت پشتیبانی می‌کند، رندر فریم‌به‌فریم لازم نیست. صدای اصلی
// دست‌نخورده کپی می‌شود (-c:a copy)، فقط ویدیو دوباره انکود می‌شود (برای اعمال فیلتر زیرنویس).
export async function burnCaptions({
  inputBuffer,
  inputExt,
  assContent,
}: BurnCaptionsTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const assPath = join(dir, `${randomUUID()}.ass`);
    const outPath = join(dir, `${randomUUID()}.mp4`);
    await writeFile(inPath, inputBuffer);
    await writeFile(assPath, assContent, 'utf8');
    await runFfmpeg([
      '-y', '-i', inPath,
      '-vf', `ass=${assPath}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outPath,
    ]);
    return readFile(outPath);
  });
}
