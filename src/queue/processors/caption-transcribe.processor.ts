import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { CaptionProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { AsrService } from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';

// docs/PRD-video-auto-captions.md §۳/§۱۶/§۱۷ — تنها پردازشگر این فیچر که واقعاً payload می‌گیرد:
// دانلود ویدیوی مبدأ از MinIO → استخراج صدا (worker thread، بخش ۱۶.۲) → ASR با زنجیره‌ی
// fallback ۴ مدله (بخش ۱۷) → ذخیره‌ی transcriptWords در CaptionProject. برخلاف رندر (بخش ۱۴.۴)،
// این مرحله هیچ اعتباری کسر نمی‌کند — ادیت/تعویض استایل باید رایگان و نامحدود بماند.
//
// عمداً نیازی به transcodeVideo (نرمال‌سازی HEVC→h264) این‌جا نیست: extractAudio صرفاً استریم
// صدا را می‌گیرد (`-vn`)، مستقل از کدک ویدیویی کانتینر — آن تابع فقط برای رندر نهایی (بخش ۵.۱)
// یا فیچر ادیت ویدیو (docs/PRD-video-studio-editing.md) لازم می‌شود.
@Processor('caption-transcribe')
export class CaptionTranscribeProcessor {
  private readonly logger = new Logger(CaptionTranscribeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly asr: AsrService,
    private readonly aiProvider: AiProviderService,
  ) {}

  @Process('transcribe')
  async handleTranscribe(job: Job<{ captionProjectId: string }>) {
    const { captionProjectId } = job.data;
    const project = await this.prisma.captionProject.findUnique({
      where: { id: captionProjectId },
    });
    if (!project) {
      this.logger.warn(`caption-transcribe: project ${captionProjectId} not found, skipping`);
      return;
    }

    await this.prisma.captionProject.update({
      where: { id: captionProjectId },
      data: { status: CaptionProjectStatus.TRANSCRIBING },
    });

    try {
      this.logger.log(
        `caption-transcribe project=${captionProjectId}: دانلود ویدیوی مبدأ از MinIO، key=${project.sourceVideoKey}`,
      );
      const videoBuffer = await this.storage.downloadImage(project.sourceVideoKey);
      const ext = project.sourceVideoKey.split('.').pop() ?? 'mp4';
      this.logger.log(
        `caption-transcribe project=${captionProjectId}: ویدیو دانلود شد، videoBytes=${videoBuffer.length} ext=${ext}`,
      );

      const audioBuffer = await this.mediaTranscode.extractAudio(videoBuffer, ext);
      this.logger.log(
        `caption-transcribe project=${captionProjectId}: استخراج صدا با ffmpeg تمام شد، audioBytes=${audioBuffer.length}`,
      );

      // ابعاد واقعی سورس — برای اینکه فرانت بتواند گزینه‌های رزولوشن خروجی (HD/Full HD/4K) را
      // فقط تا سقف رزولوشن واقعی کاربر نشان دهد، بدون نیاز به دانلود دوباره‌ی کل ویدیو
      let sourceWidth: number | null = null;
      let sourceHeight: number | null = null;
      try {
        const dims = await this.mediaTranscode.getVideoDimensions(videoBuffer, ext);
        sourceWidth = dims.width;
        sourceHeight = dims.height;
      } catch (dimsErr) {
        this.logger.warn(
          `caption-transcribe project=${captionProjectId}: تشخیص ابعاد ویدیو failed (نادیده گرفته می‌شود): ${(dimsErr as Error).message}`,
        );
      }

      // لاگ تشخیصی: صدای استخراج‌شده را هم در MinIO آپلود می‌کنیم تا در صورت خطای ASR بشود
      // همین فایل را مستقیم از MinIO دانلود کرد و با گوش‌دادن/ffprobe چک کرد که واقعاً صحیح
      // extract شده یا نه — خطای آپلود دیباگ نباید کل job را fail کند. کلید واقعی روی پروژه
      // ذخیره می‌شود تا بعداً (حذف دستی/cron cleanup) بشود همین فایل را هم پاک کرد.
      let debugAudioKey: string | null = null;
      try {
        debugAudioKey = await this.storage.uploadImage(
          audioBuffer,
          'mp3',
          `caption-debug-audio`,
        );
        this.logger.log(
          `caption-transcribe project=${captionProjectId}: صدای استخراج‌شده برای بررسی دستی در MinIO آپلود شد، bucket key=${debugAudioKey}`,
        );
      } catch (uploadErr) {
        this.logger.warn(
          `caption-transcribe project=${captionProjectId}: آپلود دیباگ صدا در MinIO failed (نادیده گرفته می‌شود): ${(uploadErr as Error).message}`,
        );
      }

      const apiKey = this.aiProvider.sharedApiKey;
      this.logger.log(
        `caption-transcribe project=${captionProjectId}: شروع ASR (زبان=fa) با زنجیره‌ی fallback`,
      );
      const result = await this.asr.transcribeWithFallback(audioBuffer, apiKey, 'fa');
      this.logger.log(
        `caption-transcribe project=${captionProjectId}: ASR موفق شد با مدل=${result.modelUsed} durationSec=${result.durationSec} costUsd=${result.costUsd}`,
      );

      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: {
          transcriptWords: result.words as unknown as object,
          asrModelName: result.modelUsed,
          asrCostUsd: result.costUsd,
          sourceDurationSec: result.durationSec,
          sourceWidth,
          sourceHeight,
          debugAudioKey,
          status: CaptionProjectStatus.READY_FOR_EDIT,
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `caption-transcribe failed for project=${captionProjectId}: ${error.message}`,
        error.stack,
      );
      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: { status: CaptionProjectStatus.FAILED },
      });
      throw error; // اجازه بده Bull attempts/backoff (بخش ۱۶.۴) کار خودش را بکند
    }
  }
}
