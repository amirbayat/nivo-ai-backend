import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  PricingGenerationType,
  VideoJobStatus,
  VideoModelProvider,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PricingService } from '../usage/pricing.service';
import { PricingTiersService } from '../usage/pricing-tiers.service';
import { PushFcmService } from '../push-notifications/fcm.service';
import { VeoProviderService } from '../../common/services/veo-provider.service';
import { RunwayProviderService } from '../../common/services/runway-provider.service';
import { verifyKieWebhookSignature } from '../../common/services/kie-webhook-signature.util';
import { resolveExternalProviderCostUsd } from '../kie-video-models/generic-payload-builder';
import { fa } from '../../i18n/fa';

// شکل دقیق بدنه‌ی webhook بین Veo و Runway فرق دارد (تایید‌شده از docs.kie.ai ۱۴۰۵/۰۶/۲۷):
//   Veo:    { code, msg, data: { taskId,   info: { resultUrls: [...] } } }
//   Runway: { code, msg, data: { task_id,  video_url } }
// این تایپ عمداً loose است — نه یک DTO با class-validator، چون رد نکردن یک کالبک واقعی به‌خاطر
// یک فیلد اضافه/غیرمنتظره مهم‌تر از اعتبارسنجی سخت‌گیرانه است (polling همچنان fallback اصلی است).
interface KieWebhookBody {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    task_id?: string;
    info?: { resultUrls?: string[] };
    video_url?: string;
    response?: { resultUrls?: string[]; fullResultUrls?: string[] };
  };
}

function extractTaskId(data: KieWebhookBody['data']): string | null {
  return data?.taskId ?? data?.task_id ?? null;
}

function extractResultUrl(data: KieWebhookBody['data']): string | null {
  return (
    data?.info?.resultUrls?.[0] ??
    data?.video_url ??
    data?.response?.fullResultUrls?.[0] ??
    data?.response?.resultUrls?.[0] ??
    null
  );
}

// webhook فقط یک fast-path/safety-net اضافه‌ست، نه جایگزین polling (که در video-edit.processor.ts
// همچنان بدون تغییر روی هر job فعال اجرا می‌شود). سه حالت:
//   ۱) job هنوز PROCESSING → کاری نکن، همون poll loop فعال خودش نتیجه رو می‌گیرد (رقابت با آن
//      یعنی ریسک کسر دوباره‌ی کیف‌پول، پس این مسیر عمداً دست‌نخورده می‌ماند)
//   ۲) job از قبل SUCCEEDED (یا resultVideoKey دارد) → no-op، قبلاً از مسیر عادی تمام شده
//   ۳) job FAILED با «polling timed out» ولی webhook می‌گوید provider موفق بوده (دقیقاً باگ
//      گزارش‌شده‌ی Veo ۱۴۰۵/۰۶/۲۷) → تنها حالتی که این سرویس واقعاً finalize می‌کند (بازیابی)
@Injectable()
export class VideoEditWebhookService {
  private readonly logger = new Logger(VideoEditWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly pricingTiers: PricingTiersService,
    private readonly pushFcm: PushFcmService,
    private readonly veoProvider: VeoProviderService,
    private readonly runwayProvider: RunwayProviderService,
    private readonly config: ConfigService,
  ) {}

  async handleKieCallback(
    body: unknown,
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
  ): Promise<void> {
    // مهم‌ترین لاگ برای دیباگ — بدنه‌ی خام قبل از هر تصمیمی چاپ می‌شود، چون شکل دقیق فیلدها
    // فقط از مستندات Kie تخمین زده شده (نه تست زنده)؛ اگر چیزی درست کار نکرد، اول همین‌جا
    // ببین Kie واقعاً چه چیزی فرستاده
    this.logger.log(
      `kie webhook: received raw body=${JSON.stringify(body)} timestamp=${timestampHeader ?? 'missing'} hasSignature=${!!signatureHeader}`,
    );

    const payload = (body ?? {}) as KieWebhookBody;
    const taskId = extractTaskId(payload.data);
    if (!taskId) {
      this.logger.warn(
        'kie webhook: payload بدون taskId قابل‌تشخیص — نادیده گرفته شد',
      );
      return;
    }

    const secret = this.config.get<string>('KIE_WEBHOOK_HMAC_KEY');
    if (!secret) {
      this.logger.warn(
        `kie webhook: KIE_WEBHOOK_HMAC_KEY ست نشده — callback برای taskId=${taskId} نادیده گرفته شد (polling همچنان فعال است)`,
      );
      return;
    }
    const signatureValid = verifyKieWebhookSignature(
      taskId,
      timestampHeader,
      signatureHeader,
      secret,
    );
    this.logger.log(
      `kie webhook: signature valid=${signatureValid} taskId=${taskId}`,
    );
    if (!signatureValid) {
      throw new UnauthorizedException('امضای webhook نامعتبر است');
    }

    const videoJob = await this.prisma.videoEditJob.findFirst({
      where: { kieTaskId: taskId },
      include: { kieVideoModel: true },
    });
    if (!videoJob) {
      // ممکن است taskId مربوط به فیچر دیگری از همین اکانت Kie باشد که هنوز به این webhook
      // وصل نشده — رفتار طبیعی، نه یک خطا
      this.logger.log(
        `kie webhook: هیچ video-edit job‌ای با taskId=${taskId} پیدا نشد`,
      );
      return;
    }
    this.logger.log(
      `kie webhook: job=${videoJob.id} taskId=${taskId} status=${videoJob.status} provider=${videoJob.kieVideoModel.provider} resultVideoKey=${videoJob.resultVideoKey ?? 'null'}`,
    );
    if (
      videoJob.resultVideoKey ||
      videoJob.status === VideoJobStatus.SUCCEEDED
    ) {
      this.logger.log(
        `kie webhook: job=${videoJob.id} قبلاً SUCCEEDED — no-op`,
      );
      return;
    }
    if (videoJob.status !== VideoJobStatus.FAILED) {
      // PROCESSING (یا نظری PENDING) — poll loop فعال خودش صاحب این job است، دست نمی‌زنیم
      this.logger.log(
        `kie webhook: job=${videoJob.id} هنوز status=${videoJob.status} — poll loop فعال خودش نتیجه رو می‌گیرد، دست نمی‌زنیم`,
      );
      return;
    }

    const provider = videoJob.kieVideoModel.provider;
    if (
      provider !== VideoModelProvider.VEO &&
      provider !== VideoModelProvider.RUNWAY
    ) {
      this.logger.warn(
        `kie webhook: بازیابی برای provider=${provider} هنوز پیاده نشده (job=${videoJob.id}) — این مدل صرفاً با polling معمولی جواب گرفته یا از دست رفته`,
      );
      return;
    }

    if (payload.code !== 200) {
      // job از قبل به‌خاطر تایم‌اوت ما FAILED شده؛ فقط پیام دقیق‌تر provider را جایگزین پیام
      // عمومی «polling timed out» می‌کنیم — بدون عملیات مالی
      this.logger.log(
        `kie webhook: job=${videoJob.id} code=${payload.code} (نه ۲۰۰) — provider هم fail گزارش کرده، فقط errorMessage آپدیت می‌شود`,
      );
      if (payload.msg) {
        await this.prisma.videoEditJob.update({
          where: { id: videoJob.id },
          data: { errorMessage: payload.msg.slice(0, 500) },
        });
      }
      return;
    }

    const resultUrl = extractResultUrl(payload.data);
    if (!resultUrl) {
      this.logger.warn(
        `kie webhook: code=200 ولی resultUrl از هیچ فیلد شناخته‌شده‌ای استخراج نشد (job=${videoJob.id}, taskId=${taskId}) — شکل payload بالا رو چک کن`,
      );
      return;
    }

    this.logger.log(
      `kie webhook: job=${videoJob.id} در حال بازیابی (status قبلی=FAILED، provider موفق گزارش کرده) resultUrl=${resultUrl}`,
    );
    await this.recoverSuccess(videoJob, resultUrl, provider);
  }

  // قفل خوش‌بینانه در سطح DB — اگر webhook دوبار برسد (رفتار شناخته‌شده‌ی خیلی از providerها)،
  // فقط اولین updateMany برنده می‌شود؛ بقیه با count=0 مواجه شده و زود برمی‌گردند، بدون کسر
  // دوباره‌ی کیف‌پول. status موقتاً PROCESSING می‌شود صرفاً به‌عنوان قفل، نه چون job واقعاً در
  // حال poll است (آن poll loop قبلاً با throw تمام و از صف خارج شده).
  private async recoverSuccess(
    videoJob: {
      id: string;
      userId: string;
      mode: string;
      valuesJson: Prisma.JsonValue;
      kieVideoModelId: string;
      kieVideoModel: {
        inputFields: Prisma.JsonValue;
        pricePerSecondUsdConfirmed: number | null;
      };
    },
    resultUrl: string,
    provider: typeof VideoModelProvider.VEO | typeof VideoModelProvider.RUNWAY,
  ): Promise<void> {
    const claimed = await this.prisma.videoEditJob.updateMany({
      where: {
        id: videoJob.id,
        status: VideoJobStatus.FAILED,
        resultVideoKey: null,
      },
      data: { status: VideoJobStatus.PROCESSING },
    });
    if (claimed.count === 0) {
      this.logger.warn(
        `kie webhook: claim برای job=${videoJob.id} رد شد (count=0) — احتمالاً همین لحظه یک بار دیگر webhook رسیده یا وضعیت تغییر کرده`,
      );
      return;
    }

    try {
      const client =
        provider === VideoModelProvider.VEO
          ? this.veoProvider
          : this.runwayProvider;
      const buffer = await client.downloadResult(resultUrl);
      const resultVideoKey = await this.storage.uploadImage(
        buffer,
        'mp4',
        videoJob.id,
      );

      const costUsd = resolveExternalProviderCostUsd(
        videoJob.kieVideoModel,
        videoJob.valuesJson,
      );
      const costCalc = await this.pricing.calcFlatCostToman(costUsd);
      const markup = await this.pricingTiers.getMarkup(
        PricingGenerationType.VIDEO,
        costCalc.costToman,
      );
      const providerLabel =
        provider === VideoModelProvider.VEO ? 'Veo' : 'Runway';
      const debited = await this.pricing.debitWallet(
        videoJob.userId,
        costCalc.costToman,
        markup,
        `ویرایش ویدیو (${providerLabel}) — ${videoJob.mode} (بازیابی‌شده بعد از تایم‌اوت polling)`,
        {
          feature: 'video-edit',
          jobId: videoJob.id,
          kieVideoModelId: videoJob.kieVideoModelId,
          costToman: costCalc.costToman,
          recoveredViaWebhook: true,
        },
      );
      if (!debited) {
        this.logger.error(
          `kie webhook recovery debitWallet: insufficient balance race user=${videoJob.userId} job=${videoJob.id}`,
        );
      }

      await this.prisma.videoEditJob.update({
        where: { id: videoJob.id },
        data: {
          status: VideoJobStatus.SUCCEEDED,
          resultVideoKey,
          creditsConsumedRaw: costUsd,
          creditCost: costCalc.costToman,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      await this.notifyUser(
        videoJob.userId,
        fa.videoEdit.jobReadyPushTitle,
        fa.videoEdit.jobReadyPushBody,
      );
      this.logger.log(
        `kie webhook: job=${videoJob.id} بعد از تایم‌اوت polling با webhook بازیابی و SUCCEEDED شد`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `kie webhook recovery failed for job=${videoJob.id}: ${error.message}`,
        error.stack,
      );
      // برگرداندن به FAILED — علت اصلی (تایم‌اوت) دست‌نخورده می‌ماند، فقط دیگر روی PROCESSING گیر نمی‌کند
      await this.prisma.videoEditJob.update({
        where: { id: videoJob.id },
        data: { status: VideoJobStatus.FAILED },
      });
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
}
