import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { CaptionProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import {
  buildAssSubtitle,
  buildDefaultSegments,
  type CaptionSegment,
  type CaptionStyleOverrides,
} from '../../common/services/ass-subtitle-builder';
import { PricingService } from '../../modules/usage/pricing.service';
import { CaptionPricingService } from '../../modules/usage/caption-pricing.service';
import { CreditsService } from '../../modules/credits/credits.service';
import { PushFcmService } from '../../modules/push-notifications/fcm.service';
import { fa } from '../../i18n/fa';

// docs/PRD-video-auto-captions.md §۵.۱/§۱۴.۴ — دانلود ویدیوی مبدأ → ساخت فایل ASS از
// segments/styleOverrides → سوزاندن با ffmpeg+libass (worker thread) → آپلود خروجی →
// کسر اعتبار *فقط بعد از موفقیت* (دقیقاً الگوی studio-video-generation.processor.ts).
// قیمت‌گذاری این فیچر cost-based نیست (بخش ۱۴.۲) — مبلغ ثابت از CaptionPricingService
// (بر اساس sourceDurationSec) می‌آید، نه هزینه‌ی خام ASR.
@Processor('caption-render')
export class CaptionRenderProcessor {
  private readonly logger = new Logger(CaptionRenderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly pricing: PricingService,
    private readonly captionPricing: CaptionPricingService,
    private readonly credits: CreditsService,
    private readonly pushFcm: PushFcmService,
  ) {}

  private async notifyUser(userId: string, title: string, body: string) {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { fcmToken: true },
    });
    if (!tokens.length) return;
    await this.pushFcm.sendToTokens(
      tokens.map((t) => t.fcmToken),
      title,
      body,
    );
  }

  @Process('render')
  async handleRender(job: Job<{ captionProjectId: string; targetHeight?: number }>) {
    const { captionProjectId, targetHeight } = job.data;
    this.logger.log(
      `caption-render: job دریافت شد project=${captionProjectId} jobId=${job.id} attemptsMade=${job.attemptsMade}`,
    );
    const project = await this.prisma.captionProject.findUnique({
      where: { id: captionProjectId },
    });
    if (!project) {
      this.logger.warn(`caption-render: project ${captionProjectId} not found, skipping`);
      return;
    }

    if (project.sourceDeletedAt) {
      this.logger.warn(
        `caption-render project=${captionProjectId}: sourceVideoKey از قبل حذف شده، رندر ممکن نیست`,
      );
      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: { status: CaptionProjectStatus.FAILED },
      });
      return;
    }

    await this.prisma.captionProject.update({
      where: { id: captionProjectId },
      data: { status: CaptionProjectStatus.RENDERING, renderProgress: 0 },
    });

    // لاگ‌های گام‌به‌گام (بخش ۱۶.۴ درخواست‌شده) — رندر چند مرحله‌ی کند دارد (دانلود فایل حجیم،
    // ffmpeg re-encode)؛ بدون این لاگ‌ها تشخیص اینکه یک رندر «طولانی» واقعاً کجا گیر کرده
    // (دانلود از MinIO، خودِ ffmpeg، آپلود خروجی، یا هیچ‌کدام و اصلاً worker پردازش نکرده)
    // ممکن نیست.
    const t0 = Date.now();
    try {
      this.logger.log(
        `caption-render project=${captionProjectId}: شروع، دانلود ویدیوی مبدأ از MinIO key=${project.sourceVideoKey} targetHeight=${targetHeight ?? 'source'}`,
      );
      const videoBuffer = await this.storage.downloadImage(project.sourceVideoKey);
      const ext = project.sourceVideoKey.split('.').pop() ?? 'mp4';
      this.logger.log(
        `caption-render project=${captionProjectId}: ویدیو دانلود شد (${videoBuffer.length} بایت) در ${Date.now() - t0}ms`,
      );

      const dims = await this.mediaTranscode.getVideoDimensions(videoBuffer, ext);
      this.logger.log(
        `caption-render project=${captionProjectId}: ابعاد سورس ${dims.width}x${dims.height}`,
      );

      // فقط رزولوشن‌های مساوی یا کوچک‌تر از سورس معتبرند (بدون آپ‌اسکیل جعلی) — عرض با
      // گرد کردن به نزدیک‌ترین عدد زوج (الزام libx264) از نسبت تصویر واقعی محاسبه می‌شود
      const targetDimensions =
        targetHeight && targetHeight > 0 && targetHeight < dims.height
          ? {
              width: Math.round((dims.width * (targetHeight / dims.height)) / 2) * 2,
              height: targetHeight,
            }
          : undefined;
      const outputWidth = targetDimensions?.width ?? dims.width;
      const outputHeight = targetDimensions?.height ?? dims.height;

      const segments =
        (project.segments as unknown as CaptionSegment[] | null) ??
        buildDefaultSegments(
          (project.transcriptWords as unknown as { word: string; start: number; end: number }[] | null) ?? [],
        );
      const assContent = await buildAssSubtitle(
        segments,
        project.styleOverrides as unknown as CaptionStyleOverrides | null,
        outputWidth,
        outputHeight,
      );
      this.logger.log(
        `caption-render project=${captionProjectId}: فایل ASS ساخته شد (${segments.length} segment، خروجی ${outputWidth}x${outputHeight})`,
      );

      // مدت واقعی سورس برای محاسبه‌ی درصد پیشرفت از out_time خروجی ffmpeg -progress — از قبل
      // در project.sourceDurationSec (مرحله‌ی transcribe) موجود است، نیازی به ffprobe جدید نیست
      const durationSec = project.sourceDurationSec ?? undefined;
      let lastReportedProgress = -1;
      const burnStart = Date.now();
      const renderedBuffer = await this.mediaTranscode.burnCaptions(
        videoBuffer,
        ext,
        assContent,
        targetDimensions,
        durationSec,
        (percent) => {
          // throttle — ffmpeg -progress هر چند صدم ثانیه یک خط می‌فرستد، نوشتن هر تیک روی
          // دیتابیس هم لازم نیست هم فشار بی‌مورد به Postgres پروداکشن است
          if (percent <= lastReportedProgress) return;
          lastReportedProgress = percent;
          this.prisma.captionProject
            .update({ where: { id: captionProjectId }, data: { renderProgress: percent } })
            .catch((err) =>
              this.logger.warn(`caption-render progress update failed project=${captionProjectId}: ${err}`),
            );
        },
      );
      this.logger.log(
        `caption-render project=${captionProjectId}: ffmpeg burnCaptions تمام شد در ${Date.now() - burnStart}ms (خروجی ${renderedBuffer.length} بایت)`,
      );

      const renderedVideoKey = await this.storage.uploadImage(renderedBuffer, 'mp4');
      this.logger.log(
        `caption-render project=${captionProjectId}: خروجی در MinIO آپلود شد key=${renderedVideoKey}`,
      );

      const creditCost = await this.captionPricing.getCreditCost(project.sourceDurationSec ?? 0);
      const creditConfig = await this.credits.getConfig();
      const finalToman = creditCost * creditConfig.tomanPerCredit;

      // markup=1 — قیمت از قبل ثابت است (مثل الگوی nivo-cal.service.ts scan)، نه هزینه‌محور
      const debited = await this.pricing.debitWallet(
        project.userId,
        finalToman,
        1,
        fa.captionStudio.renderDebitDescription,
        {
          feature: 'caption-render',
          captionProjectId,
          creditCost,
          asrCostUsd: project.asrCostUsd ?? undefined,
        },
      );
      if (!debited) {
        this.logger.error(
          `caption-render debitWallet: insufficient balance race for user=${project.userId} project=${captionProjectId}`,
        );
      }

      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: {
          status: CaptionProjectStatus.DONE,
          renderedVideoKey,
          renderCreditCost: creditCost,
        },
      });

      await this.notifyUser(
        project.userId,
        fa.captionStudio.videoReadyPushTitle,
        fa.captionStudio.videoReadyPushBody,
      );
      this.logger.log(
        `caption-render project=${captionProjectId}: کامل شد در ${Date.now() - t0}ms مجموع`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `caption-render failed for project=${captionProjectId}: ${error.message}`,
        error.stack,
      );
      await this.prisma.captionProject.update({
        where: { id: captionProjectId },
        data: { status: CaptionProjectStatus.FAILED },
      });
      await this.notifyUser(
        project.userId,
        fa.captionStudio.renderFailedPushTitle,
        fa.captionStudio.renderFailedPushBody,
      );
      throw error; // اجازه بده Bull attempts/backoff (بخش ۱۶.۴) کار خودش را بکند
    }
  }
}
