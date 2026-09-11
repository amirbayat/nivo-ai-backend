import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePort } from 'node:worker_threads';
import { renderCaptionFrames } from './canvas-caption-renderer';
import type {
  CaptionSegment,
  CaptionStyleOverrides,
} from './caption-style-catalog';
import {
  displaySizeAfterRotation,
  isQuarterTurnRotation,
  rotationFromProbeStream,
} from '../utils/video-display-aspect';

export interface ExtractAudioTask {
  inputBuffer: Buffer;
  inputExt: string; // پسوند واقعی فایل ورودی (mp4, mov, ...) — فقط برای این‌که ffmpeg پسوند معتبر ببیند
}

export interface TranscodeVideoTask {
  inputBuffer: Buffer;
  inputExt: string;
}

export interface NormalizedVideo {
  buffer: Buffer;
  ext: 'mp4';
}

export interface BurnCaptionsTask {
  inputBuffer: Buffer;
  inputExt: string;
  segments: CaptionSegment[];
  styleOverrides: CaptionStyleOverrides | null;
  // مدت کامل ویدیو (میلی‌ثانیه) — برای پر کردن کل تایم‌لاین رندر کپشن (renderCaptionFrames)
  // بدون گپ لازم است
  videoDurationMs: number;
  // ابعاد دقیق خروجی نهایی — بر خلاف ass=/libass قدیمی (که با PlayResX/Y هر رزولوشنی را
  // auto-scale می‌کرد)، فریم‌های PNG رندرشده باید از قبل دقیقاً به همین ابعاد باشند تا overlay
  // با فریم‌های ویدیوی اسکیل‌شده یکی دربیاید — caption-render.processor.ts این را همیشه با
  // ابعاد واقعی ورودی (وقتی هدف/دانلود رزولوشن پایین‌تر انتخاب نشده) پر می‌کند، هرگز undefined
  outputWidth: number;
  outputHeight: number;
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

interface ProbedVideoStream {
  codec_name?: string;
  pix_fmt?: string;
  color_transfer?: string;
  rotation: number;
}

interface VideoProbe {
  videoStreams: ProbedVideoStream[];
  hasAudio: boolean;
}

function isHdrTransfer(transfer?: string): boolean {
  return transfer === 'smpte2084' || transfer === 'arib-std-b67';
}

async function probeVideo(inPath: string): Promise<VideoProbe> {
  const out = await runFfprobe([
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type,codec_name,pix_fmt,color_transfer:stream_tags=rotate:stream_side_data=rotation',
    '-of',
    'json',
    inPath,
  ]);
  const parsed = JSON.parse(out) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      color_transfer?: string;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };
  const streams = parsed.streams ?? [];
  return {
    videoStreams: streams
      .filter((s) => s.codec_type === 'video')
      .map((s) => ({
        codec_name: s.codec_name,
        pix_fmt: s.pix_fmt,
        color_transfer: s.color_transfer,
        rotation: rotationFromProbeStream(s),
      })),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

function isProviderCompatible(probe: VideoProbe, inputExt: string): boolean {
  if (inputExt !== 'mp4') return false;
  if (probe.videoStreams.length !== 1) return false;
  const main = probe.videoStreams[0];
  if (main.codec_name !== 'h264') return false;
  if (main.pix_fmt && main.pix_fmt !== 'yuv420p') return false;
  if (isHdrTransfer(main.color_transfer)) return false;
  // Phone clips are often already h264/mp4 but still carry rotate=90. Passing
  // them through leaves the tag on the file; Kie/Gemini then see landscape.
  if (isQuarterTurnRotation(main.rotation)) return false;
  return true;
}

// Map only the first video stream (iPhone Cinematic extra disparity/depth tracks are dropped)
// and the first audio stream. Bake rotation, convert HEVC/HDR/10-bit to H.264 yuv420p.
async function transcodeForProviders(
  inPath: string,
  outPath: string,
  opts: { hasAudio: boolean; hdr: boolean },
): Promise<void> {
  const vf = opts.hdr
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2'
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p';
  const args = [
    '-y',
    '-i',
    inPath,
    '-map',
    '0:v:0',
    ...(opts.hasAudio ? ['-map', '0:a:0'] : ['-an']),
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-vf',
    vf,
    ...(opts.hasAudio
      ? ['-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '128k']
      : []),
    '-movflags',
    '+faststart',
    '-metadata:s:v:0',
    'rotate=0',
    '-max_muxing_queue_size',
    '4096',
    outPath,
  ];
  await runFfmpeg(args);
}

// HEVC/.mov/iPhone Cinematic/HDR → H.264/.mp4 before sending to any provider
export async function transcodeVideo({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<Buffer> {
  const normalized = await normalizeVideoForProviders({ inputBuffer, inputExt });
  return normalized.buffer;
}

export async function normalizeVideoForProviders({
  inputBuffer,
  inputExt,
}: TranscodeVideoTask): Promise<NormalizedVideo> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    await writeFile(inPath, inputBuffer);
    const probe = await probeVideo(inPath);
    if (!probe.videoStreams.length) {
      throw new Error('no video stream in uploaded file');
    }
    if (isProviderCompatible(probe, inputExt)) {
      return { buffer: inputBuffer, ext: 'mp4' };
    }
    const outPath = join(dir, `${randomUUID()}.mp4`);
    const hdr = isHdrTransfer(probe.videoStreams[0]?.color_transfer);
    try {
      await transcodeForProviders(inPath, outPath, {
        hasAudio: probe.hasAudio,
        hdr,
      });
    } catch (err) {
      if (!hdr) throw err;
      await transcodeForProviders(inPath, outPath, {
        hasAudio: probe.hasAudio,
        hdr: false,
      });
    }
    return { buffer: await readFile(outPath), ext: 'mp4' };
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
      'stream=width,height:stream_tags=rotate:stream_side_data=rotation',
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
    return displaySizeAfterRotation(
      stream.width,
      stream.height,
      rotationFromProbeStream(stream),
    );
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

// سوزاندن زیرنویس روی ویدیو، دو پاس با canvas-caption-renderer.ts به‌جای ffmpeg+libass —
// چون زنجیر کردن صدها فیلتر overlay (یکی به‌ازای هر کلمه) در یک filter_complex برای ویدیوهای
// واقعی (صدها کلمه) مقیاس‌پذیر نیست: پاس A تمام «لایه‌ی کپشن» را یک‌بار به یک ویدیوی آلفای
// جدا (overlay.mkv، کدک png که rgba را native پشتیبانی می‌کند) تبدیل می‌کند، پاس B (فقط یک
// overlay) آن را روی ویدیوی اصلی می‌نشاند. صدای اصلی دست‌نخورده کپی می‌شود (-c:a copy).
export async function burnCaptions({
  inputBuffer,
  inputExt,
  segments,
  styleOverrides,
  videoDurationMs,
  outputWidth,
  outputHeight,
  durationSec,
  progressPort,
}: BurnCaptionsTask): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, `${randomUUID()}.${inputExt}`);
    const overlayPath = join(dir, `${randomUUID()}-overlay.mkv`);
    const outPath = join(dir, `${randomUUID()}.mp4`);
    await writeFile(inPath, inputBuffer);

    const onProgress = progressPort
      ? (percent: number) => progressPort.postMessage(percent)
      : undefined;

    const frames = await renderCaptionFrames(
      segments,
      styleOverrides,
      outputWidth,
      outputHeight,
      videoDurationMs,
    );

    // فریم‌های شفاف/گپ (بین/قبل/بعد segmentها) همگی همان یک buffer را reference می‌کنند
    // (renderCaptionFrames از blankFramePng یک instance مشترک برمی‌گرداند) — به‌جای نوشتن
    // هرکدام به فایل جدا، فقط یک‌بار نوشته و در concat list چندبار reference می‌شود
    const writtenPathByBuffer = new Map<Buffer, string>();
    const framePaths = await Promise.all(
      frames.map(async (frame, i) => {
        const existing = writtenPathByBuffer.get(frame.png);
        if (existing) return existing;
        const framePath = join(dir, `frame-${String(i).padStart(5, '0')}.png`);
        await writeFile(framePath, frame.png);
        writtenPathByBuffer.set(frame.png, framePath);
        return framePath;
      }),
    );

    const concatLines: string[] = ['ffconcat version 1.0'];
    frames.forEach((frame, i) => {
      concatLines.push(`file '${framePaths[i]}'`);
      concatLines.push(`duration ${((frame.endMs - frame.startMs) / 1000).toFixed(3)}`);
    });
    // ffconcat: duration آخرین فایل فقط با تکرار همان فایل بدون duration اعمال می‌شود
    if (framePaths.length > 0) {
      concatLines.push(`file '${framePaths[framePaths.length - 1]}'`);
    }
    const framesListPath = join(dir, 'frames.txt');
    await writeFile(framesListPath, concatLines.join('\n'), 'utf8');

    onProgress?.(0);
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      framesListPath,
      '-fps_mode',
      'vfr',
      '-pix_fmt',
      'rgba',
      '-c:v',
      'png',
      overlayPath,
    ]);
    onProgress?.(15);

    // ویدیوی مبدأ همیشه به همان ابعادی اسکیل می‌شود که overlay.mkv با آن رندر شده — چون
    // overlay یک لایه‌ی raster پیکسلی است (نه ASS/libass که با PlayResX/Y هر ابعادی را
    // auto-scale می‌کرد)، اگر ابعاد فریم پایه با ابعاد overlay یکی نباشد، ffmpeg با خطای
    // «different frame sizes» متوقف می‌شود.
    const filterComplex = `[0:v]scale=${outputWidth}:${outputHeight}[base];[base][1:v]overlay=0:0[v]`;

    await runFfmpegWithProgress(
      [
        '-y',
        '-i',
        inPath,
        '-i',
        overlayPath,
        '-progress',
        'pipe:1',
        '-filter_complex',
        filterComplex,
        '-map',
        '[v]',
        '-map',
        '0:a:0?',
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
      onProgress ? (percent) => onProgress(15 + Math.round(percent * 0.85)) : undefined,
    );
    return readFile(outPath);
  });
}
