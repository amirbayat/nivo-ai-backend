import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PricingGenerationType, VideoJobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PricingService } from '../../modules/usage/pricing.service';
import { PricingTiersService } from '../../modules/usage/pricing-tiers.service';
import { KieProviderService } from '../../common/services/kie-provider.service';
import { OpenRouterVideoProviderService } from '../../common/services/openrouter-video-provider.service';
import { PushFcmService } from '../../modules/push-notifications/fcm.service';
import { fa } from '../../i18n/fa';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 180; // ۳۰ دقیقه سقف — همون منطق studio-video-generation.processor.ts

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// docs/PRD-video-edit-omni-kie.md بخش ۵.۲ — تنها پردازشگری که واقعاً با Kie.ai حرف می‌زند.
// submit (یا resume اگر kieTaskId از قبل ثبت شده — الگوی دقیق studio-video-generation.processor.ts
// برای job های stalled/re-run) → poll دوره‌ای → دانلود از URL موقت Kie → آپلود MinIO → کسر
// اعتبار *فقط بعد از موفقیت*، بر مبنای creditsConsumed واقعی (نه تخمین) → پوش نوتیفیکیشن.
@Processor('video-edit')
export class VideoEditProcessor {
  private readonly logger = new Logger(VideoEditProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly pricingTiers: PricingTiersService,
    private readonly kieProvider: KieProviderService,
    private readonly openRouterProvider: OpenRouterVideoProviderService,
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

  // ورودی خام Kie را از روی ردیف job + کاتالوگ مدل می‌سازد — مدل‌آگنوستیک (بخش ۲ سند):
  // فقط فیلدهایی که واقعاً پر شده‌اند اضافه می‌شوند، بدون فرض‌گرفتن شکل ثابت برای هر مدل
  private async buildKieInput(job: {
    prompt: string;
    referenceImageKeys: string[];
    videoKey: string | null;
    videoWindowStartSec: number | null;
    videoWindowEndSec: number | null;
    aspectRatio: string | null;
    resolution: string;
  }): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
    };

    if (job.videoKey) {
      const buffer = await this.storage.downloadImage(job.videoKey);
      const { url } = await this.kieProvider.uploadFile(
        buffer,
        `${job.videoKey}`,
      );
      input.video_list = [
        {
          url,
          start: job.videoWindowStartSec ?? 0,
          ends: job.videoWindowEndSec ?? 8,
        },
      ];
    } else {
      // duration فقط وقتی معنا دارد که ویدیویی داده نشده — Kie خودش نادیده می‌گیرد وگرنه
      // (بخش ۲.۱ سند)؛ رشته چون schema رسمی نمونه‌اش را همیشه به‌صورت رشته نشان داده ("4")
      input.aspect_ratio = job.aspectRatio ?? '16:9';
    }

    if (job.referenceImageKeys.length) {
      const urls: string[] = [];
      for (const key of job.referenceImageKeys) {
        const buffer = await this.storage.downloadImage(key);
        const { url } = await this.kieProvider.uploadFile(buffer, key);
        urls.push(url);
      }
      input.image_urls = urls;
    }

    return input;
  }

  // OpenRouter input_references — تایید‌شده با تست مستقیم API امروز (۱۴۰۵/۰۶/۱۷): آرایه‌ی
  // input_references علاوه بر type:"image_url" (مستند رسمی)، type:"video_url" را هم می‌پذیرد و
  // به بالادستی (ByteDance/MiniMax) فوروارد می‌کند — جایی در مستندات رسمی OpenRouter نوشته
  // نشده، ولی با خطای دقیق «URL پیدا نشد» (نه خطای schema/نام فیلد غلط) برای هر ۵ مدل هدف
  // (Seedance 2.0/2.0-fast/2.0-mini/2.5, Hailuo H3) تایید شد. هیچ trim/window تایید‌شده‌ای برای
  // video_url پیدا نشد (برخلاف video_list.start/ends در Kie)، پس کل بافر ویدیوی آپلودشده
  // فرستاده می‌شود — همین باعث می‌شود مسیر EDIT (پنجره‌ی اجباری) فقط برای provider=KIE ارائه
  // شود (گارد در video-edit.service.ts/validateAgainstMode).
  private async buildOpenRouterInput(
    job: {
      prompt: string;
      referenceImageKeys: string[];
      videoKey: string | null;
      aspectRatio: string | null;
      resolution: string;
    },
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      // وقتی ویدیوی مرجع داده شده، Seedance این را ویرایش تشخیص می‌دهد و مدت زمان خروجی را
      // از خودِ ویدیوی ورودی می‌گیرد — duration باید دقیقاً -1 باشد، نه حذف و نه مقدار تولید
      // (خطای پروداکشن ۱۴۰۵/۰۶/۱۷: "duration must be -1" برای Seedance 2.5)
      duration: job.videoKey ? -1 : durationSec,
      ...(job.videoKey ? {} : { aspect_ratio: job.aspectRatio ?? '16:9' }),
    };

    // همان آپلودر موقت Kie (public URL) برای هر دو نوع رفرنس — OpenRouter برای input_references
    // به یک URL واقعی fetchable نیاز دارد، نه data URI (حجم ویدیو تا ۱۰۰ مگابایت است)
    const references: Record<string, unknown>[] = [];
    for (const key of job.referenceImageKeys) {
      const buffer = await this.storage.downloadImage(key);
      const { url } = await this.kieProvider.uploadFile(buffer, key);
      references.push({ type: 'image_url', image_url: { url } });
    }
    if (job.videoKey) {
      const buffer = await this.storage.downloadImage(job.videoKey);
      const { url } = await this.kieProvider.uploadFile(buffer, job.videoKey);
      references.push({ type: 'video_url', video_url: { url } });
    }
    if (references.length) input.input_references = references;

    return input;
  }

  @Process('render')
  async handleRender(job: Job<{ jobId: string }>) {
    const { jobId } = job.data;
    const videoJob = await this.prisma.videoEditJob.findUnique({
      where: { id: jobId },
      include: { kieVideoModel: true },
    });
    if (!videoJob) {
      this.logger.warn(`video-edit: job ${jobId} not found, skipping`);
      return;
    }

    await this.prisma.videoEditJob.update({
      where: { id: jobId },
      data: { status: VideoJobStatus.PROCESSING },
    });

    const isOpenRouter = videoJob.kieVideoModel.provider === 'OPENROUTER';
    let taskId: string | null = null;
    try {
      // resume به‌جای resubmit — دقیقاً همون گارد idempotency studio-video-generation.processor.ts
      // برای وقتی worker وسط poll طولانی (تا ۳۰دقیقه) ری‌استارت شود
      taskId = videoJob.kieTaskId;
      if (taskId) {
        this.logger.warn(
          `video-edit: job=${jobId} re-run detected (kieTaskId=${taskId} already set, provider=${videoJob.kieVideoModel.provider}) — resuming poll instead of resubmitting`,
        );
      } else {
        const config = await this.prisma.videoEditConfig.upsert({
          where: { id: 'singleton' },
          create: { id: 'singleton' },
          update: {},
        });

        if (isOpenRouter) {
          // برخلاف Kie (که duration را کلاً حذف می‌کند)، برای OpenRouter وقتی ویدیوی رفرنس
          // داده شده duration باید -1 فرستاده شود، نه حذف شود — رجوع کن به buildOpenRouterInput
          const input = await this.buildOpenRouterInput(
            videoJob,
            config.generateFixedDurationSec,
          );
          const submitted = await this.openRouterProvider.createVideoJob(
            videoJob.kieVideoModel.slug,
            input,
          );
          taskId = submitted.id;
        } else {
          const durationForGenerate = videoJob.videoKey
            ? undefined
            : config.generateFixedDurationSec;
          const input = await this.buildKieInput(videoJob);
          if (durationForGenerate) input.duration = String(durationForGenerate);

          const submitted = await this.kieProvider.createTask(
            videoJob.kieVideoModel.slug,
            input,
          );
          taskId = submitted.taskId;
        }
        await this.prisma.videoEditJob.update({
          where: { id: jobId },
          data: { kieTaskId: taskId },
        });
      }

      let resultUrl: string | undefined;
      let creditsConsumed: number | undefined; // فقط Kie
      let realCostUsd: number | undefined; // فقط OpenRouter — دلار مستقیم، نه credit
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        if (isOpenRouter) {
          const status = await this.openRouterProvider.pollVideoJob(taskId);
          if (status.status === 'completed') {
            resultUrl = status.resultUrl;
            realCostUsd = status.realCostUsd;
            break;
          }
          if (
            status.status === 'failed' ||
            status.status === 'cancelled' ||
            status.status === 'expired'
          ) {
            throw new Error(
              status.errorMessage ?? `OpenRouter video job ${status.status}`,
            );
          }
        } else {
          const status = await this.kieProvider.pollTask(taskId);
          if (status.state === 'success') {
            resultUrl = status.resultUrls[0];
            creditsConsumed = status.creditsConsumed;
            break;
          }
          if (status.state === 'fail') {
            throw new Error(status.failMsg ?? 'Kie job failed on provider side');
          }
        }
      }
      if (!resultUrl) throw new Error('video-edit job polling timed out');

      const buffer = isOpenRouter
        ? await this.openRouterProvider.downloadVideoResult(taskId)
        : await this.kieProvider.downloadResult(resultUrl);
      const resultVideoKey = await this.storage.uploadImage(
        buffer,
        'mp4',
        videoJob.id,
      );

      // هزینه‌ی واقعی: Kie از creditsConsumed*نرخ (بخش ۶.۵ سند — نرخ ۰.۰۰۵ $=1000credit، تایید‌شده
      // با حساب واقعی Kie.ai ۱۴۰۵/۰۶/۱۵)؛ OpenRouter مستقیم usage.cost دلاری برمی‌گرداند، نیازی
      // به تبدیل نرخ نیست (تایید‌شده با تست زنده‌ی امروز، مثلاً $0.415481 برای ۴ث/480p).
      const KIE_USD_PER_CREDIT = 0.005;
      const costUsd = isOpenRouter
        ? (realCostUsd ?? 0)
        : (creditsConsumed ?? 0) * KIE_USD_PER_CREDIT;
      const costCalc = await this.pricing.calcFlatCostToman(costUsd);
      const markup = await this.pricingTiers.getMarkup(
        PricingGenerationType.VIDEO,
        costCalc.costToman,
      );
      const debited = await this.pricing.debitWallet(
        videoJob.userId,
        costCalc.costToman,
        markup,
        `ویرایش ویدیو (${isOpenRouter ? 'OpenRouter' : 'Kie.ai'}) — ${videoJob.mode}`,
        {
          feature: 'video-edit',
          jobId,
          kieVideoModelId: videoJob.kieVideoModelId,
          creditsConsumed,
          realCostUsd,
          costToman: costCalc.costToman,
        },
      );
      if (!debited) {
        this.logger.error(
          `video-edit debitWallet: insufficient balance race for user=${videoJob.userId} job=${jobId}`,
        );
      }

      await this.prisma.videoEditJob.update({
        where: { id: jobId },
        data: {
          status: VideoJobStatus.SUCCEEDED,
          resultVideoKey,
          // OpenRouter: usd واقعی (realCostUsd) در همین فیلد ذخیره می‌شود، نه creditsConsumed —
          // چون مفهوم «رقم خام گزارش‌شده‌ی provider» است، صرفاً واحدش عوض می‌شود
          creditsConsumedRaw: isOpenRouter ? (realCostUsd ?? null) : (creditsConsumed ?? null),
          creditCost: costCalc.costToman,
          completedAt: new Date(),
        },
      });
      await this.notifyUser(
        videoJob.userId,
        fa.videoEdit.jobReadyPushTitle,
        fa.videoEdit.jobReadyPushBody,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `video-edit failed for job=${jobId} taskId=${taskId ?? 'n/a'}: ${error.message}`,
        error.stack,
      );
      await this.prisma.videoEditJob.update({
        where: { id: jobId },
        data: {
          status: VideoJobStatus.FAILED,
          errorMessage: error.message.slice(0, 500),
          completedAt: new Date(),
        },
      });
      await this.notifyUser(
        videoJob.userId,
        fa.videoEdit.jobFailedPushTitle,
        fa.videoEdit.jobFailedPushBody,
      );
    }
  }
}
