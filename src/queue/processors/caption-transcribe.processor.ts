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
      const videoBuffer = await this.storage.downloadImage(project.sourceVideoKey);
      const ext = project.sourceVideoKey.split('.').pop() ?? 'mp4';

      const audioBuffer = await this.mediaTranscode.extractAudio(videoBuffer, ext);

      const apiKey = this.aiProvider.sharedApiKey;
      const result = await this.asr.transcribeWithFallback(audioBuffer, apiKey, 'fa');

      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: {
          transcriptWords: result.words as unknown as object,
          asrModelName: result.modelUsed,
          asrCostUsd: result.costUsd,
          sourceDurationSec: result.durationSec,
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
