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
  async handleRender(job: Job<{ captionProjectId: string }>) {
    const { captionProjectId } = job.data;
    const project = await this.prisma.captionProject.findUnique({
      where: { id: captionProjectId },
    });
    if (!project) {
      this.logger.warn(`caption-render: project ${captionProjectId} not found, skipping`);
      return;
    }

    await this.prisma.captionProject.update({
      where: { id: captionProjectId },
      data: { status: CaptionProjectStatus.RENDERING },
    });

    try {
      const videoBuffer = await this.storage.downloadImage(project.sourceVideoKey);
      const ext = project.sourceVideoKey.split('.').pop() ?? 'mp4';

      const dims = await this.mediaTranscode.getVideoDimensions(videoBuffer, ext);

      const segments =
        (project.segments as unknown as CaptionSegment[] | null) ??
        buildDefaultSegments(
          (project.transcriptWords as unknown as { word: string; start: number; end: number }[] | null) ?? [],
        );
      const assContent = buildAssSubtitle(
        segments,
        project.styleOverrides as unknown as CaptionStyleOverrides | null,
        dims.width,
        dims.height,
      );

      const renderedBuffer = await this.mediaTranscode.burnCaptions(videoBuffer, ext, assContent);
      const renderedVideoKey = await this.storage.uploadImage(renderedBuffer, 'mp4');

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
