import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import {
  AiModelType,
  StudioShotVideoStatus,
  type AiModel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PricingService } from '../../modules/usage/pricing.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { VideoGenerationService } from '../../common/services/video-generation.service';
import { PushFcmService } from '../../modules/push-notifications/fcm.service';
import { fa } from '../../i18n/fa';

const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120; // ۳۰ دقیقه سقف — بیشتر از این یعنی چیزی خراب است، شکست بزن

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// docs/PRD-video-studio-chat-flow.md §۸.۶ — تنها پردازشگر صف این پروژه که واقعاً payload
// می‌گیرد (بقیه‌ی processors/*.ts جاب‌های cron سیستمی بدون داده‌اند). submit → poll دوره‌ای →
// دانلود و ذخیره در MinIO → کسر اعتبار *فقط بعد از موفقیت* → پوش نوتیفیکیشن؛ شکست هرجای این
// زنجیره یعنی videoStatus=FAILED و هیچ کسری از کیف‌پول کاربر انجام نمی‌شود.
@Processor('studio-video-generation')
export class StudioVideoGenerationProcessor {
  private readonly logger = new Logger(StudioVideoGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly aiProvider: AiProviderService,
    private readonly videoGen: VideoGenerationService,
    private readonly pushFcm: PushFcmService,
  ) {}

  private async resolveModel(preferredName?: string | null): Promise<AiModel> {
    if (preferredName) {
      const m = await this.prisma.aiModel.findUnique({ where: { name: preferredName } });
      if (m && m.isActive && m.modelType === AiModelType.VIDEO_GEN) return m;
    }
    const [fallback] = await this.prisma.aiModel.findMany({
      where: {
        isActive: true,
        modelType: AiModelType.VIDEO_GEN,
        platform: { has: this.aiProvider.platform },
      },
      orderBy: { sortOrder: 'asc' },
      take: 1,
    });
    if (!fallback) throw new Error('no active VIDEO_GEN model available');
    return fallback;
  }

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
  async handleRender(job: Job<{ shotId: string }>) {
    const { shotId } = job.data;
    const shot = await this.prisma.studioShot.findUnique({
      where: { id: shotId },
      include: { project: true },
    });
    if (!shot) {
      this.logger.warn(`studio-video-generation: shot ${shotId} not found, skipping`);
      return;
    }

    await this.prisma.studioShot.update({
      where: { id: shotId },
      data: { videoStatus: StudioShotVideoStatus.PROCESSING },
    });

    try {
      const model = await this.resolveModel(shot.project.videoModelId);
      const apiKey = this.aiProvider.sharedApiKey;

      // این job طولانی‌مدت است (تا ۳۰ دقیقه sleep در حلقه‌ی poll)؛ اگر وسط کار worker
      // (پاد بک‌اند) عوض/ری‌استارت شود، Bull این job را stalled تشخیص می‌دهد و از نو
      // روی handleRender اجرا می‌کند — یعنی این تابع دوباره از خط ۷۲ اجرا می‌شود. `shot`
      // بالا هنوز videoJobId این اجرای جدید را ندارد (تازه از DB خوانده شده)، ولی اگر
      // videoJobId از یک اجرای *قبلی* (که هنوز زنده و در حال poll است) از قبل ثبت شده
      // باشد، یعنی این یک re-run است، نه اولین submit — به‌جای submitVideoJob دوباره
      // (که یک jobId جدید و مصرف اضافه‌ی provider می‌سازد و اجرای قبلی را orphan می‌کند)،
      // همان job قبلی را resume/poll می‌کنیم. requestShotVideo (video-studio.service.ts)
      // همیشه قبل از هر enqueue تازه videoJobId را null می‌کند، پس این فیلد در ابتدای
      // handleRender فقط از یک re-run واقعی می‌تواند پر باشد.
      let jobId = shot.videoJobId;
      if (jobId) {
        this.logger.warn(
          `studio-video-generation: shot=${shotId} re-run detected (videoJobId=${jobId} already set) — resuming poll instead of resubmitting`,
        );
      } else {
        const referenceImage = shot.previewImageKey
          ? await this.storage.downloadImage(shot.previewImageKey)
          : undefined;

        const submitted = await this.videoGen.submitVideoJob({
          modelId: model.name,
          prompt: shot.scenario,
          apiKey,
          durationSec: model.videoGenSupportedDurationsSec[0] ?? 4,
          size:
            model.videoGenSupportedSizes.find((s) =>
              matchesAspectRatio(s, shot.project.videoAspectRatio),
            ) ?? model.videoGenSupportedSizes[0],
          audioEnabled: shot.audioEnabled,
          referenceImage,
        });
        jobId = submitted.jobId;
        await this.prisma.studioShot.update({
          where: { id: shotId },
          data: { videoJobId: jobId },
        });
      }

      const durationSec = model.videoGenSupportedDurationsSec[0] ?? 4;

      let videoUrl: string | undefined;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const status = await this.videoGen.pollVideoJob(jobId, apiKey);
        if (status.status === 'completed') {
          videoUrl = status.videoUrl;
          break;
        }
        if (
          status.status === 'failed' ||
          status.status === 'cancelled' ||
          status.status === 'expired'
        ) {
          throw new Error(
            status.error ?? `video job ${status.status} on provider side`,
          );
        }
      }
      if (!videoUrl) throw new Error('video job polling timed out');

      const buffer = await this.videoGen.downloadVideo(videoUrl);
      const videoKey = await this.storage.uploadImage(
        buffer,
        'mp4',
        shot.projectId,
      );
      const costCalc = await this.pricing.calcVideoGenCost(
        model,
        durationSec,
        shot.audioEnabled,
      );

      const debited = await this.pricing.debitWallet(
        shot.project.userId,
        costCalc.costToman,
        1,
        `تولید ویدیو — صحنه ${shot.order + 1}`,
        { feature: 'video-studio-shot', projectId: shot.projectId, shotId },
      );
      if (!debited)
        this.logger.error(
          `studio-video debitWallet: insufficient balance race for user=${shot.project.userId} shot=${shotId}`,
        );

      await this.prisma.studioShot.update({
        where: { id: shotId },
        data: {
          videoStatus: StudioShotVideoStatus.SUCCEEDED,
          videoKey,
          creditCost: costCalc.costToman,
        },
      });
      await this.notifyUser(
        shot.project.userId,
        fa.videoStudio.videoReadyPushTitle,
        fa.videoStudio.videoReadyPushBody(shot.title),
      );
    } catch (err) {
      this.logger.error(
        `studio-video-generation failed for shot=${shotId}: ${(err as Error).message}`,
      );
      await this.prisma.studioShot.update({
        where: { id: shotId },
        data: { videoStatus: StudioShotVideoStatus.FAILED },
      });
      await this.notifyUser(
        shot.project.userId,
        fa.videoStudio.videoFailedPushTitle,
        fa.videoStudio.videoFailedPushBody(shot.title),
      );
    }
  }
}

// اندازه‌ی "WxH" را به نزدیک‌ترین نسبت ۱۶:۹/۹:۱۶/۱:۱ نگاشت می‌کند — چون هر مدل ویدیو اندازه‌های
// پشتیبانی‌شده‌ی خودش را دارد (openroutermodels.json)، نه یک لیست ثابت مشترک
function matchesAspectRatio(size: string, target: string | null): boolean {
  if (!target) return false;
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return false;
  const ratio = Number(match[1]) / Number(match[2]);
  const targets: Record<string, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
  };
  const targetRatio = targets[target];
  if (!targetRatio) return false;
  return Math.abs(ratio - targetRatio) < 0.05;
}
