import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import Piscina from 'piscina';
import type {
  BurnCaptionsTask,
  ExtractAudioTask,
  TranscodeVideoTask,
  VideoDimensions,
} from './media-transcode.worker';

// ffmpeg خودش با child_process.spawn یک OS process جداست، ولی نوشتن/خواندن buffer و مدیریت
// فایل موقت هم بهتر است از ترد اصلی Node دور بماند تا HTTP request handling + SSE چت مسدود
// نشود — دقیقاً همان الگوی modules/usage/token-estimator.service.ts، فقط با دو تابع جدا
// (extractAudio/transcodeVideo) روی یک worker file (Piscina named-tasks).
// docs/PRD-video-auto-captions.md §۱۶.۱/۱۶.۲ + docs/PRD-video-studio-editing.md §۷.۱
@Injectable()
export class MediaTranscodeService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaTranscodeService.name);

  // maxThreads کوچک عمداً — CPU/IO-bound محلی است، نه چیزی که با thread بیشتر از core های
  // واقعی سریع‌تر شود (همان توضیح token-estimator.service.ts)
  private readonly pool = new Piscina({
    filename: join(__dirname, 'media-transcode.worker.js'),
    minThreads: 1,
    maxThreads: 2,
  });

  async extractAudio(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
    const task: ExtractAudioTask = { inputBuffer, inputExt };
    const result = await this.pool.run(task, { name: 'extractAudio' });
    // پیام‌رسانی Piscina بین worker/main thread با structured clone انجام می‌شود که ساب‌کلاس
    // Buffer را حفظ نمی‌کند — چیزی که برمی‌گردد یک Uint8Array معمولی است، نه Buffer واقعی
    // (instanceof Buffer === false)، با اینکه امضای تابع Promise<Buffer> اعلام شده. بدون این
    // rewrap، کالرهایی مثل MinIO.putObject (چک isBuffer) یا Buffer.prototype.toString('base64')
    // (که روی Uint8Array خام نادیده گرفته می‌شود و یک رشته‌ی اعشاری comma-separated بی‌معنی
    // می‌دهد) بی‌سروصدا داده‌ی خراب تولید می‌کنند
    return Buffer.from(result);
  }

  async transcodeVideo(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
    const task: TranscodeVideoTask = { inputBuffer, inputExt };
    const result = await this.pool.run(task, { name: 'transcodeVideo' });
    return Buffer.from(result);
  }

  async getVideoDimensions(inputBuffer: Buffer, inputExt: string): Promise<VideoDimensions> {
    const task: TranscodeVideoTask = { inputBuffer, inputExt };
    return this.pool.run(task, { name: 'getVideoDimensions' });
  }

  async burnCaptions(inputBuffer: Buffer, inputExt: string, assContent: string): Promise<Buffer> {
    const task: BurnCaptionsTask = { inputBuffer, inputExt, assContent };
    const result = await this.pool.run(task, { name: 'burnCaptions' });
    return Buffer.from(result);
  }

  async onModuleDestroy() {
    await this.pool
      .destroy()
      .catch((err) => this.logger.error('media transcode pool destroy failed', err));
  }
}
