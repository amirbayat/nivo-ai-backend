import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import {
  KieInputSchema,
  PricingGenerationType,
  VideoJobStatus,
  type KieVideoModel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PricingService } from '../../modules/usage/pricing.service';
import { PricingTiersService } from '../../modules/usage/pricing-tiers.service';
import {
  KieProviderService,
  type KieJobState,
} from '../../common/services/kie-provider.service';
import {
  OpenRouterVideoProviderService,
  type OpenRouterVideoJobStatus,
} from '../../common/services/openrouter-video-provider.service';
import { VeoProviderService } from '../../common/services/veo-provider.service';
import { RunwayProviderService } from '../../common/services/runway-provider.service';
import type { VideoProviderClient } from '../../common/services/video-provider-client.interface';
import { PushFcmService } from '../../modules/push-notifications/fcm.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { fa } from '../../i18n/fa';
import { parseInputFields } from '../../modules/kie-video-models/input-fields.schema';
import {
  buildGenericKiePayload,
  resolveEffectiveDurationSec,
  type FieldValues,
  type MediaUploader,
} from '../../modules/kie-video-models/generic-payload-builder';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 180; // ۳۰ دقیقه سقف — همون منطق studio-video-generation.processor.ts

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// پراگرس واقعی (گام ۵): هر سه مسیر provider (Kie/Veo/Runway مشترکاً KieJobState، OpenRouter
// جداگانه) روی یک state-machine مشترک نگاشت می‌شوند تا فرانت (VideoEditGallery.tsx) بدون آگاهی
// از provider، فقط یک stepper وضعیت‌محور رندر کند — نه یک درصد جعلی (هیچ‌کدام از این providerها
// عدد پراگرس واقعی برنمی‌گردانند، پس progressPercent عمداً دست‌نخورده/null می‌ماند).
function normalizeOpenRouterState(status: OpenRouterVideoJobStatus): KieJobState {
  switch (status) {
    case 'pending':
      return 'waiting';
    case 'processing':
      return 'generating';
    case 'completed':
      return 'success';
    default:
      // failed / cancelled / expired — جزئیات دقیق خطا از errorMessage جدا مصرف می‌شود
      return 'fail';
  }
}

// فیلدهای مشترکی که هر ۵ input-builder از روی ردیف VideoEditJob لازم دارند
type JobFields = {
  prompt: string;
  referenceImageKeys: string[];
  videoKey: string | null;
  videoWindowStartSec: number | null;
  videoWindowEndSec: number | null;
  aspectRatio: string | null;
  resolution: string;
};

function isVideoStorageKey(key: string): boolean {
  return /\.(mp4|mov)$/i.test(key);
}

function extFromStorageKey(key: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(key);
  return match?.[1]?.toLowerCase() ?? 'mp4';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Wan V2V فقط enum رشته‌ای ثابت می‌پذیرد (مثلاً فقط "5"/"10")، بدون مقدار میانی — نزدیک‌ترین
// گزینه‌ی مجاز مدل به durationSec پیشنهادی انتخاب می‌شود
function pickClosestFixedDuration(options: number[], target: number): number {
  if (!options.length) return target;
  return options.reduce((closest, v) =>
    Math.abs(v - target) < Math.abs(closest - target) ? v : closest,
  );
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
    private readonly veoProvider: VeoProviderService,
    private readonly runwayProvider: RunwayProviderService,
    private readonly pushFcm: PushFcmService,
    private readonly mediaTranscode: MediaTranscodeService,
  ) {}

  // پراگرس واقعی — نوشتن state بعد از هر poll (نه فقط شروع/پایان)، طوری که Gallery بتونه
  // stepper وضعیت‌محور واقعی نشون بده. خطای نوشتن (مثلاً DB لحظه‌ای در دسترس نبود) نباید کل
  // job رو fail کنه — فقط warn و ادامه‌ی polling.
  private async updateKieState(jobId: string, state: KieJobState) {
    try {
      await this.prisma.videoEditJob.update({
        where: { id: jobId },
        data: { kieState: state },
      });
    } catch (err) {
      this.logger.warn(
        `video-edit: failed to persist kieState for job=${jobId}: ${(err as Error).message}`,
      );
    }
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

  // ابزار مشترک هر ۵ builder — دانلود از MinIO + آپلود موقت Kie، برای یک کلید تکی
  private async uploadRef(key: string): Promise<string> {
    const buffer = await this.loadProviderVideoBuffer(key);
    const { url } = await this.kieProvider.uploadFile(
      buffer,
      isVideoStorageKey(key) ? key.replace(/\.[^.]+$/, '.mp4') : key,
    );
    return url;
  }

  private async loadProviderVideoBuffer(key: string): Promise<Buffer> {
    const buffer = await this.storage.downloadImage(key);
    if (!isVideoStorageKey(key)) return buffer;
    const normalized = await this.mediaTranscode.normalizeVideoForProviders(
      buffer,
      extFromStorageKey(key),
    );
    return normalized.buffer;
  }

  private async uploadRefs(keys: string[]): Promise<string[]> {
    const urls: string[] = [];
    for (const key of keys) urls.push(await this.uploadRef(key));
    return urls;
  }

  // پل بین uploadRef/uploadRefs موجود (که به this.storage/this.kieProvider وابسته‌اند) و
  // buildGenericKiePayload (که عمداً مستقل از این دو سرویس نوشته شده — کنار مدل‌های
  // KIE، همین uploader برای Veo/Runway هم قابل بازاستفاده است)
  private mediaUploader(): MediaUploader {
    return {
      uploadOne: (key: string) => this.uploadRef(key),
      uploadMany: (keys: string[]) => this.uploadRefs(keys),
    };
  }

  // Omni: video_list آبجکتی با پنجره‌ی start/ends (تنها مدل با trim واقعی)؛ duration وقتی
  // ویدیویی داده شده کلاً نادیده گرفته می‌شود (بخش ۲.۱ سند)
  private async buildOmniInput(
    job: JobFields,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
    };
    if (job.videoKey) {
      input.video_list = [
        {
          url: await this.uploadRef(job.videoKey),
          start: job.videoWindowStartSec ?? 0,
          ends: job.videoWindowEndSec ?? 8,
        },
      ];
    } else {
      input.duration = String(durationSec);
      input.aspect_ratio = job.aspectRatio ?? '16:9';
    }
    if (job.referenceImageKeys.length) {
      input.image_urls = await this.uploadRefs(job.referenceImageKeys);
    }
    return input;
  }

  // Seedance (2.5/2.0/2.0-fast/2.0-mini، هم روی OpenRouter هم Kie): reference_video_urls،
  // duration:-1 یعنی «هم‌طول ویدیوی مرجع» (تایید‌شده مستقیم روی Kie ۱۴۰۵/۰۶/۱۷ — برخلاف
  // OpenRouter که -1 را در همون gateway رد می‌کند). هیچ trim/window‌ای نیست، کل بافر می‌رود.
  private async buildSeedanceInput(
    job: JobFields,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      duration: job.videoKey ? -1 : durationSec,
      ...(job.videoKey ? {} : { aspect_ratio: job.aspectRatio ?? '16:9' }),
    };
    if (job.referenceImageKeys.length) {
      input.reference_image_urls = await this.uploadRefs(
        job.referenceImageKeys,
      );
    }
    if (job.videoKey) {
      input.reference_video_urls = [await this.uploadRef(job.videoKey)];
    }
    return input;
  }

  // Wan 2.6 Video-to-Video: duration فقط enum رشته‌ای ثابت ("5"/"10") — sentinel ندارد، پس
  // نزدیک‌ترین مقدار مجاز مدل (KieVideoModel.fixedDurations) به durationSec انتخاب می‌شود
  private async buildWanV2VInput(
    job: JobFields,
    model: KieVideoModel,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      duration: String(pickClosestFixedDuration(model.fixedDurations, durationSec)),
      ...(job.videoKey ? {} : { aspect_ratio: job.aspectRatio ?? '16:9' }),
    };
    if (job.videoKey) input.video_urls = [await this.uploadRef(job.videoKey)];
    return input;
  }

  // Wan 2.7 Reference-to-Video: duration عدد ساده در بازه‌ی [2,10]، بدون sentinel — فقط clamp
  private async buildWanR2VInput(
    job: JobFields,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      duration: clamp(durationSec, 2, 10),
      ...(job.videoKey ? {} : { aspect_ratio: job.aspectRatio ?? '16:9' }),
    };
    if (job.referenceImageKeys.length) {
      input.reference_image = await this.uploadRefs(job.referenceImageKeys);
    }
    if (job.videoKey) input.reference_video = [await this.uploadRef(job.videoKey)];
    return input;
  }

  // Wan 2.7 VideoEdit: video_url تکی (نه آرایه)؛ duration:0 یعنی «طول کامل ورودی بدون برش» —
  // sentinel متفاوت از Seedance (-1) و Omni (نادیده‌گرفتن کامل)
  private async buildWanVideoEditInput(
    job: JobFields,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      duration: job.videoKey ? 0 : durationSec,
      ...(job.videoKey ? {} : { aspect_ratio: job.aspectRatio ?? '16:9' }),
    };
    if (job.videoKey) input.video_url = await this.uploadRef(job.videoKey);
    if (job.referenceImageKeys.length) {
      input.reference_image = await this.uploadRefs(job.referenceImageKeys);
    }
    return input;
  }

  // dispatcher — کدام builder بر اساس KieVideoModel.kieInputSchema صدا زده شود؛ اضافه‌کردن
  // خانواده‌ی ششم یعنی یک case جدید اینجا + یک builder جدید، نه دست‌کاری بقیه
  private async buildKieInputForModel(
    job: JobFields,
    model: KieVideoModel,
    durationSec: number,
  ): Promise<Record<string, unknown>> {
    switch (model.kieInputSchema) {
      case KieInputSchema.SEEDANCE:
        return this.buildSeedanceInput(job, durationSec);
      case KieInputSchema.WAN_V2V:
        return this.buildWanV2VInput(job, model, durationSec);
      case KieInputSchema.WAN_R2V:
        return this.buildWanR2VInput(job, durationSec);
      case KieInputSchema.WAN_VIDEO_EDIT:
        return this.buildWanVideoEditInput(job, durationSec);
      case KieInputSchema.OMNI:
      default:
        return this.buildOmniInput(job, durationSec);
    }
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
    // نکته‌ی مهم (بررسی‌شده با تست زنده‌ی API ۱۴۰۵/۰۶/۱۷، سه سناریو): duration مثبت همیشه ارسال
    // می‌شود، حتی وقتی ویدیوی مرجع داده شده — چون تست‌های زیر ثابت کرد مشکل مربوط به «حضور
    // ویدیوی مرجع» نیست، مربوط به تشخیص خودِ Seedance از روی **متن پرامپت** است:
    //   ۱) duration=-1 صریح → رد می‌شود توسط خودِ gateway schema OpenRouter (نه ByteDance):
    //      `duration: too_small, minimum 1` — یعنی -1 هرگز از این مسیر عبور نمی‌کند.
    //   ۲) duration کلاً حذف‌شده + پرامپت شبیه دستور ویرایش («تغییر بده X، بقیه رو نگه‌دار») →
    //      قبول (202) ولی در پردازش واقعی شکست می‌خورد: "Seedance identified your task as video
    //      editing based on your prompt... duration must be -1" — و چون گزینه‌ی (۱) بسته است،
    //      این حالت خاص (پرامپت ویرایش‌گونه + ویدیوی مرجع) از مسیر OpenRouter اصلاً ممکن نیست؛
    //      نه passthrough (`provider.options.seed.parameters.duration`) کمک کرد، چون "duration"
    //      اصلاً جزو allowed_passthrough_parameters این مدل نیست و بی‌صدا حذف می‌شود.
    //   ۳) duration مثبت + پرامپت تولیدی («یه ویدیوی سینمایی از...، با الهام از ویدیوی مرجع») →
    //      کامل موفق (تایید‌شده، هزینه‌ی واقعی $0.556 برای ۴ث/480p+یک ویدیوی مرجع).
    // نتیجه: duration مثبت همیشه درست است؛ تنها حالتی که شکست می‌خورد (پرامپت‌های ویرایش‌گونه)
    // یک محدودیت واقعی سمت OpenRouter/ByteDance است که از این مسیر قابل‌دورزدن نیست — آن حالت
    // فقط باید به‌عنوان شکست job (نه کرش) به کاربر نشان داده شود.
    const input: Record<string, unknown> = {
      prompt: job.prompt,
      resolution: job.resolution,
      duration: durationSec,
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
      const buffer = await this.loadProviderVideoBuffer(job.videoKey);
      const { url } = await this.kieProvider.uploadFile(
        buffer,
        job.videoKey.replace(/\.[^.]+$/, '.mp4'),
      );
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
    // Veo/Runway هر دو endpoint اختصاصی خودشان را دارند (نه jobs/createTask عمومی Kie) — طبق
    // پلن بخش ۳.۶، این ۴-۵ مدل همیشه data-driven‌اند (inputFields هرگز null نیست برایشان)
    const externalProvider: VideoProviderClient | null =
      videoJob.kieVideoModel.provider === 'VEO'
        ? this.veoProvider
        : videoJob.kieVideoModel.provider === 'RUNWAY'
          ? this.runwayProvider
          : null;
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

        if (externalProvider) {
          const input = await buildGenericKiePayload(
            parseInputFields(videoJob.kieVideoModel.inputFields),
            (videoJob.valuesJson as FieldValues | null) ?? {},
            this.mediaUploader(),
          );
          const submitted = await externalProvider.submit(
            videoJob.kieVideoModel.slug,
            input,
          );
          taskId = submitted.taskId;
        } else if (isOpenRouter) {
          // duration مثبت همیشه فرستاده می‌شود، حتی با ویدیوی مرجع — رجوع کن به کامنت داخل
          // buildOpenRouterInput (تست زنده‌ی سه‌سناریویی ۱۴۰۵/۰۶/۱۷) برای دلیل کامل
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
          // دیسپچر معماری جدید/قدیمی: inputFields غیر-null یعنی از generic payload-builder
          // استفاده کن (کنار ۵ تابع buildXInput فعلی، نه جایگزین فوری — طبق پلن بخش ۳.۳)
          const input = videoJob.kieVideoModel.inputFields
            ? await buildGenericKiePayload(
                parseInputFields(videoJob.kieVideoModel.inputFields),
                (videoJob.valuesJson as FieldValues | null) ?? {},
                this.mediaUploader(),
              )
            : // هر builder قدیمی خودش تصمیم می‌گیرد duration را چطور بفرستد (نادیده‌گرفتن/-1/0/enum/بازه)
              // — رجوع کن به کامنت هرکدام برای قرارداد دقیق آن خانواده‌ی مدل
              await this.buildKieInputForModel(
                videoJob,
                videoJob.kieVideoModel,
                config.generateFixedDurationSec,
              );

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
        // اولین state قابل‌نمایش بلافاصله بعد از submit — قبل از این، Gallery چیزی جز
        // status:PROCESSING خام نداره تا اولین poll (تا ۱۰ ثانیه بعد) برسه
        await this.updateKieState(jobId, 'waiting');
      }

      let resultUrl: string | undefined;
      let creditsConsumed: number | undefined; // فقط Kie
      let realCostUsd: number | undefined; // فقط OpenRouter — دلار مستقیم، نه credit
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        if (externalProvider) {
          const status = await externalProvider.poll(taskId);
          await this.updateKieState(jobId, status.state);
          if (status.state === 'success') {
            resultUrl = status.resultUrls[0];
            break;
          }
          if (status.state === 'fail') {
            throw new Error(
              status.failMsg ?? `${videoJob.kieVideoModel.provider} job failed on provider side`,
            );
          }
        } else if (isOpenRouter) {
          const status = await this.openRouterProvider.pollVideoJob(taskId);
          await this.updateKieState(jobId, normalizeOpenRouterState(status.status));
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
            // پیام فنی/انگلیسی خام OpenRouter مستقیم به کاربر نمایش داده می‌شود
            // (VideoEditGallery.tsx: job.errorMessage) — این یک حالت شناخته‌شده است (رجوع کن
            // به کامنت buildOpenRouterInput)، پس پیام فارسی قابل‌فهم جایگزینش می‌شود
            const isEditClassificationError =
              status.errorMessage?.includes('duration must be -1') ?? false;
            throw new Error(
              isEditClassificationError
                ? fa.videoEdit.openRouterEditPromptRejected
                : (status.errorMessage ?? `OpenRouter video job ${status.status}`),
            );
          }
        } else {
          const status = await this.kieProvider.pollTask(taskId);
          await this.updateKieState(jobId, status.state);
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

      const buffer = externalProvider
        ? await externalProvider.downloadResult(resultUrl)
        : isOpenRouter
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
      // Veo/Runway هنوز فیلد هزینه‌ی خام تایید‌شده‌ای در پاسخ record-info/record-detail ندارند
      // (بررسی‌شده از docs.kie.ai ۱۴۰۵/۰۶/۲۰) — تا تایید واقعی (گام ۴)، تخمین محافظه‌کارانه‌ی
      // مبتنی بر pricePerSecondUsdConfirmed×مدت واقعی استفاده می‌شود، نه یک رقم فرضی خام.
      const KIE_USD_PER_CREDIT = 0.005;
      const costUsd = externalProvider
        ? (videoJob.kieVideoModel.pricePerSecondUsdConfirmed ?? 0.1) *
          resolveEffectiveDurationSec(
            parseInputFields(videoJob.kieVideoModel.inputFields),
            (videoJob.valuesJson as FieldValues | null) ?? {},
          )
        : isOpenRouter
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
          // Veo/Runway: همون تخمین دلاری costUsd بالا (نه یک رقم خام تایید‌شده‌ی provider — رجوع
          // کن به کامنت محاسبه‌ی costUsd)
          creditsConsumedRaw: externalProvider
            ? costUsd
            : isOpenRouter
              ? (realCostUsd ?? null)
              : (creditsConsumed ?? null),
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
