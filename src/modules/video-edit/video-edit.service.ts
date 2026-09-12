import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { generateText } from 'ai';
import type { ModelMessage, UserModelMessage } from 'ai';
import {
  Prisma,
  PricingGenerationType,
  VideoJobStatus,
  type KieVideoModel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { PricingService } from '../usage/pricing.service';
import { CreditsService } from '../credits/credits.service';
import { KieVideoModelsService } from '../kie-video-models/kie-video-models.service';
import { VideoEditConfigService } from '../video-edit-config/video-edit-config.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { CreateVideoEditJobDto } from './dto/create-video-edit-job.dto';
import { CreatePromptReviewDto } from './dto/create-prompt-review.dto';
import { fa } from '../../i18n/fa';
import { snapDisplayAspectRatio } from '../../common/utils/video-display-aspect';
import { parseInputFields } from '../kie-video-models/input-fields.schema';
import {
  resolveEffectiveDurationSec,
  validateInputValues,
  type FieldValues,
} from '../kie-video-models/generic-payload-builder';

// حدهای واقعی Kie.ai برای gemini-omni-video (بخش ۲ سند)؛ چون مدل‌های بعدی کاتالوگ ممکن است
// حد متفاوتی داشته باشند، اینها فقط سقف حجمی محافظه‌کارانه‌ی رد سریع پیش از صف‌شدن‌اند —
// سقف واقعی طول/تعداد از خودِ KieVideoModel خوانده می‌شود (اعتبارسنجی پایین‌تر همین فایل)
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 30 * 1024 * 1024;
const FALLBACK_USD_PER_SEC = 0.1;
const MIN_VIDEO_BALANCE_USD = 0.8;
const TITLE_GENERATION_MODEL = 'openai/gpt-5-nano';

// docs/PRD-video-prompt-coach.md بخش ۱ — فقط این مدل، هاردکد (بدون انتخاب‌گر/تنظیم ادمین)
const PROMPT_REVIEW_MODEL = 'google/gemini-3.8-flash';

// docs/PRD-prompt-review-expected-output.md — مارکر دوم برای جدا کردن باکس «خروجی مورد انتظار»
// از انتهای پرامپت پیشنهادی
const EXPECTED_OUTPUT_MARKER = '---خروجی مورد انتظار---';

const PROMPT_REVIEW_SYSTEM_PROMPT = `تو یک دستیار متخصص نوشتن پرامپت برای تولید ویدیو با هوش مصنوعی هستی.
کارت این است: پرامپت کاربر (و در صورت وجود، ویدیو/عکس مرجعش) را ببینی و به او کمک کنی پرامپت
بهتری بنویسد تا نتیجه‌ی تولید ویدیو باکیفیت‌تر و قابل‌پیش‌بینی‌تر باشد.

قوانین:
- فقط درباره‌ی بهبود پرامپت ویدیو صحبت کن؛ اگر کاربر موضوع نامرتبط پرسید (مثلاً درخواست چت عمومی)،
  مؤدبانه بگو این گفتگو فقط برای بهبود پرامپت ویدیوست.
- نقدت را کوتاه و مشخص بنویس: چه چیزهایی مبهم یا ناقص است (نور، حرکت دوربین، سبک، زمان‌بندی صحنه،
  جزئیات ظاهری سوژه، فضای صدا/موسیقی) — نه یک لیست طولانی، فقط نکات واقعاً مهم.
- در پایانِ نقد، همیشه دقیقاً همین مارکر را در یک خط جدا بنویس: ---پیشنهاد نهایی---
  و بلافاصله بعدش، در یک پاراگراف، خودِ پرامپت نهاییِ پیشنهادی را بنویس — فقط متن پرامپت،
  بدون هیچ توضیح یا مقدمه‌ی اضافه. این پرامپت باید همان زبان و اسلوب پرامپت‌های تولید ویدیو باشد
  (توصیفی، یک یا چند جمله، نه لیست).
- اگر کاربر در ادامه‌ی گفتگو خواست چیزی را عوض کنی (مثلاً «به‌جای صبح غروب باشه»)، پرامپت پیشنهادی
  را با همان تغییر دوباره کامل بنویس (نه فقط توضیح تغییر) — همیشه بعد از مارکر، نسخه‌ی کامل و به‌روز.
- بلافاصله بعد از پرامپت پیشنهادی، همیشه دقیقاً همین مارکر را در یک خط جدا بنویس:
  ---خروجی مورد انتظار---
  و بعدش، مثل کسی که واقعاً این ویدیو را جلوی چشمش دارد و دارد برای یک نفر که نمی‌بیندش تعریف
  می‌کند، با جزئیات کامل توضیح بده که اگر همین پرامپت پیشنهادی برای تولید ویدیو استفاده شود، کاربر
  دقیقاً چه چیزی را می‌بیند. حتماً این موارد را با جزئیات واقعی (نه اسم بردن مقوله) پوشش بده:
  تعداد و نوع سوژه(ها) و ظاهر دقیقشان (سن حدودی، پوشش، حالت چهره/بدن)، صحنه/محیط و زمان روز یا
  آب‌وهوا، اندازه‌ی نما و ترکیب‌بندی (کلوزآپ/مدیوم/وایید، مرکز کادر)، حرکت دقیق سوژه در طول صحنه،
  حرکت/زاویه‌ی دوربین (پن/تیلت/دالی/ثابت)، نور و پالت رنگ دقیق، بافت و جزئیات ریز قابل‌مشاهده،
  ریتم/سرعت و حس‌وحال کلی صحنه، و در صورت وجود فضای صدا/موسیقی. در دو تا چهار پاراگراف کوتاه بنویس
  (نه لیست، نه یک جمله‌ی کلی)، و در پایان با یک جمله‌ی کوتاه یادآوری کن که خروجی واقعی مدل تولید
  می‌تواند اندکی متفاوت باشد.`;

const ALLOWED_VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

// امضای مشترک ISO-BMFF (mp4/mov) — همون الگوی caption-studio.service.ts، تشخیص با
// magic bytes نه فقط mimetype ادعایی کلاینت
function matchesVideoMagicBytes(buffer: Buffer): boolean {
  return (
    buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  );
}

// PNG: 89 50 4E 47 — JPEG: FF D8 FF — WEBP: 'RIFF'....'WEBP'
function detectImageExt(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'jpg';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

// MP3: ID3 تگ یا فریم‌سینک خام (FF Ex/Fx) — WAV: 'RIFF'....'WAVE' — M4A/AAC: جعبه‌ی ftyp (مثل mp4)
function detectAudioExt(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'wav';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a';
  return null;
}

// docs/PRD-video-edit-omni-kie.md — منطق دامنه‌ی «ویرایش ویدیو». عمداً از AiModel/AiProviderService
// استفاده نمی‌کند (بخش ۳ سند) — یک provider کاملاً جدا (KieProviderService) دارد که فقط داخل
// پردازشگر صف صدا زده می‌شود، نه اینجا (دقیقاً الگوی video-studio.service.ts/requestShotVideo:
// preflight اینجا، submit واقعی در processor).
@Injectable()
export class VideoEditService {
  private readonly logger = new Logger(VideoEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly pricing: PricingService,
    private readonly credits: CreditsService,
    private readonly kieModels: KieVideoModelsService,
    private readonly videoEditConfig: VideoEditConfigService,
    private readonly aiProvider: AiProviderService,
    @InjectQueue('video-edit')
    private readonly videoEditQueue: Queue,
  ) {}

  async listModels() {
    const models = await this.kieModels.listActive();
    const usdPerSec = models.map(
      (m) => m.pricePerSecondUsdConfirmed ?? FALLBACK_USD_PER_SEC,
    );
    const uniqueUsd = [...new Set(usdPerSec)];
    const credits = await this.pricing.usdCostsToCredits(
      uniqueUsd,
      PricingGenerationType.VIDEO,
    );
    const creditsByUsd = new Map<number, number>();
    uniqueUsd.forEach((usd, i) => creditsByUsd.set(usd, credits[i]));
    return models.map((model, i) => ({
      ...model,
      estimatedCostPerSecondUsd: usdPerSec[i],
      estimatedCreditCostPerSecond: creditsByUsd.get(usdPerSec[i]) ?? null,
    }));
  }

  // فرانت برای نمایش عدد واقعی «مدت ثابت تولید» (به‌جای یک برچسب مبهم) به این نیاز دارد —
  // فقط فیلدهای بی‌ضرر عمومی، نه کل VideoEditConfig ادمین (بدون سقف‌های همزمانی/روزانه)
  async getPublicConfig() {
    const config = await this.videoEditConfig.getConfig();
    return {
      isEnabled: config.isEnabled,
      generateFixedDurationSec: config.generateFixedDurationSec,
    };
  }

  async uploadImage(file: Express.Multer.File): Promise<{ key: string }> {
    if (!file) throw new BadRequestException(fa.videoEdit.noFileUploaded);
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    const ext = detectImageExt(file.buffer);
    if (!ext) throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    const key = await this.storage.uploadImage(file.buffer, ext);
    return { key };
  }

  // مدت واقعی فایل (نه فرضی) هم برمی‌گرداند — فرانت از آن برای نمایش/اعتبارسنجی تریمر
  // پنجره‌ی start/end استفاده می‌کند (بخش ۵.۴ سند)، preflight هزینه هم از همین مقدار استفاده می‌کند
  async uploadVideo(
    file: Express.Multer.File,
  ): Promise<{
    key: string;
    durationSec: number;
    width: number;
    height: number;
    aspectRatio: string;
  }> {
    if (!file) throw new BadRequestException(fa.videoEdit.noFileUploaded);
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    const ext = ALLOWED_VIDEO_MIME_EXT[file.mimetype];
    if (!ext || !matchesVideoMagicBytes(file.buffer)) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    let storeBuffer = file.buffer;
    let storeExt = ext;
    try {
      const normalized = await this.mediaTranscode.normalizeVideoForProviders(
        file.buffer,
        ext,
      );
      storeBuffer = normalized.buffer;
      storeExt = normalized.ext;
    } catch {
      throw new BadRequestException(fa.videoEdit.videoTranscodeFailed);
    }
    const durationSec = await this.mediaTranscode.getVideoDuration(
      storeBuffer,
      storeExt,
    );
    const dims = await this.mediaTranscode.getVideoDimensions(
      storeBuffer,
      storeExt,
    );
    const key = await this.storage.uploadImage(storeBuffer, storeExt);
    return {
      key,
      durationSec,
      width: dims.width,
      height: dims.height,
      aspectRatio: snapDisplayAspectRatio(dims.width, dims.height),
    };
  }

  async uploadAudio(file: Express.Multer.File): Promise<{ key: string }> {
    if (!file) throw new BadRequestException(fa.videoEdit.noFileUploaded);
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    const ext = detectAudioExt(file.buffer);
    if (!ext) throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    const key = await this.storage.uploadImage(file.buffer, ext);
    return { key };
  }

  private async getActiveModelOrThrow(id: string): Promise<KieVideoModel> {
    const model = await this.kieModels.getById(id);
    if (!model.isActive)
      throw new BadRequestException(fa.videoEdit.modelDisabled);
    return model;
  }

  // دقیقاً الگوی VideoStudioService.listMyProjects — تاریخچه‌ی جلسه‌ها + جاب‌های هرکدام،
  // برای drawer تاریخچه و گالری «کارهای این جلسه» (بازطراحی ۱۴۰۵/۰۶/۱۷)
  async listMySessions(userId: string) {
    return this.prisma.videoEditSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        jobs: { orderBy: { createdAt: 'desc' }, include: { kieVideoModel: true } },
      },
    });
  }

  // «شروع ویرایش جدید» صریح از drawer تاریخچه — معمولاً لازم نیست چون createJob خودش session
  // بی‌عنوان می‌سازد وقتی sessionId نیامده، ولی این endpoint برای وقتی UI می‌خواهد قبل از هر
  // job واقعی یک session خالی در تاریخچه داشته باشد مفید است
  async createSession(userId: string, title?: string) {
    return this.prisma.videoEditSession.create({
      data: { userId, title: title ?? null },
    });
  }

  private async getOwnedSessionOrThrow(userId: string, id: string) {
    const session = await this.prisma.videoEditSession.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException(fa.videoEdit.sessionNotFound);
    if (session.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);
    return session;
  }

  // اعتبارسنجی مخصوص mode/مدل — بخش ۲ سند: GENERATE و EDIT روی یک endpoint Kie می‌روند،
  // این تفاوت فقط این‌جا (نه در schema/API) اعمال می‌شود
  private validateAgainstMode(
    dto: CreateVideoEditJobDto,
    model: KieVideoModel,
  ) {
    if (dto.mode === 'EDIT') {
      if (!dto.videoKey)
        throw new BadRequestException(fa.videoEdit.videoRequiredForEdit);
      if (dto.referenceImageKeys?.length) {
        throw new BadRequestException(fa.videoEdit.imagesNotSupportedForEdit);
      }
      // مسیر EDIT یعنی «ویرایش صحنه‌حفظ‌کننده با پنجره‌ی start/end» — فقط مدل‌هایی که واقعاً
      // این قابلیت را تایید کرده‌اند (Omni، Wan-VideoEdit) — نه صرفاً provider=KIE، چون
      // Seedance/Wan-R2V/Wan-V2V هم روی Kie هستند ولی فقط GENERATE-with-reference دارند
      // (تحقیق ۱۴۰۵/۰۶/۱۷)
      if (!model.supportsScenePreservingEdit) {
        throw new BadRequestException(
          fa.videoEdit.editModeNotSupportedByModel,
        );
      }
    }
    if (dto.videoKey) {
      if (!model.supportsVideo) {
        throw new BadRequestException(fa.videoEdit.videoNotSupportedByModel);
      }
      if (dto.videoWindowStartSec == null || dto.videoWindowEndSec == null) {
        throw new BadRequestException(fa.videoEdit.videoWindowRequired);
      }
      const windowWidth = dto.videoWindowEndSec - dto.videoWindowStartSec;
      if (windowWidth <= 0)
        throw new BadRequestException(fa.videoEdit.videoWindowRequired);
      if (model.maxVideoWindowSec && windowWidth > model.maxVideoWindowSec) {
        throw new BadRequestException(
          fa.videoEdit.videoWindowTooWide(model.maxVideoWindowSec),
        );
      }
    }
    if (dto.referenceImageKeys?.length) {
      if (!model.supportsImages) {
        throw new BadRequestException(fa.videoEdit.imagesNotSupportedByModel);
      }
      if (model.maxImages && dto.referenceImageKeys.length > model.maxImages) {
        throw new BadRequestException(
          fa.videoEdit.tooManyImages(model.maxImages),
        );
      }
    }
    // کاربر رزولوشن را از بین model.resolutions انتخاب می‌کند (نه همیشه resolutions[0]) — باید
    // دقیقاً یکی از مقادیر همین کاتالوگ باشد، وگرنه چیزی که provider پشتیبانی نمی‌کند فرستاده می‌شود
    if (dto.resolution && !model.resolutions.includes(dto.resolution)) {
      throw new BadRequestException(
        fa.videoEdit.resolutionNotSupportedByModel(model.resolutions),
      );
    }
  }

  async createJob(userId: string, dto: CreateVideoEditJobDto) {
    const config = await this.videoEditConfig.getConfig();
    if (!config.isEnabled)
      throw new BadRequestException(fa.videoEdit.featureDisabled);

    const model = await this.getActiveModelOrThrow(dto.kieVideoModelId);
    // دیسپچر معماری جدید/قدیمی — طبق پلن بخش ۳.۳: inputFields غیر-null یعنی اعتبارسنجی عمومی
    // (validateInputValues) جای منطق دستی validateAgainstMode را می‌گیرد
    const schema = model.inputFields ? parseInputFields(model.inputFields) : null;
    const valuesJson = (dto.valuesJson ?? {}) as FieldValues;
    if (schema) {
      validateInputValues(schema, valuesJson);
    } else {
      this.validateAgainstMode(dto, model);
    }

    // session یا موجود (باید مال همین کاربر باشد) یا تازه‌ساز («شروع ویرایش جدید» بی‌عنوان)
    const session = dto.sessionId
      ? await this.getOwnedSessionOrThrow(userId, dto.sessionId)
      : await this.prisma.videoEditSession.create({
          data: { userId, title: null },
        });

    const activeJobsCount = await this.prisma.videoEditJob.count({
      where: {
        userId,
        status: { in: [VideoJobStatus.PENDING, VideoJobStatus.PROCESSING] },
      },
    });
    if (activeJobsCount >= config.maxConcurrentJobsPerUser) {
      throw new BadRequestException(fa.videoEdit.tooManyConcurrentJobs);
    }

    if (config.maxJobsPerDayPerUser != null) {
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const todayCount = await this.prisma.videoEditJob.count({
        where: { userId, createdAt: { gte: since } },
      });
      if (todayCount >= config.maxJobsPerDayPerUser) {
        throw new BadRequestException(fa.videoEdit.dailyLimitReached);
      }
    }

    // preflight محافظه‌کارانه — رقم واقعی فقط بعد از creditsConsumed در پردازشگر صف مشخص
    // می‌شود (بخش ۶.۵ سند)؛ pricePerSecondUsdConfirmed تا وقتی مدل تست نشده null است، پس
    // نرخ رسمی Google/fal ($۰.۱۰) به‌عنوان تخمین محافظه‌کارانه (نه ارزان) استفاده می‌شود
    const estimateDurationSec = schema
      ? resolveEffectiveDurationSec(schema, valuesJson)
      : dto.videoKey
        ? dto.videoWindowEndSec! - dto.videoWindowStartSec!
        : config.generateFixedDurationSec;
    const estimateUsd =
      estimateDurationSec *
      (model.pricePerSecondUsdConfirmed ?? FALLBACK_USD_PER_SEC);
    const estimate = await this.pricing.calcFlatCostToman(estimateUsd);
    const minBalance = await this.pricing.calcFlatCostToman(
      MIN_VIDEO_BALANCE_USD,
    );
    const balance = await this.credits.getBalance(userId);
    if (balance.balanceToman < minBalance.costToman) {
      const neededCredits = Math.ceil(
        minBalance.costToman / balance.tomanPerCredit,
      );
      throw new BadRequestException({
        message: fa.videoEdit.insufficientMinBalance(
          neededCredits,
          balance.credits,
        ),
        code: 'INSUFFICIENT_CREDITS',
        neededCredits,
        balanceCredits: balance.credits,
      });
    }
    if (balance.balanceToman < estimate.costToman) {
      const neededCredits = Math.ceil(
        estimate.costToman / balance.tomanPerCredit,
      );
      // مبلغ لازم/موجود هم توی بدنه‌ی خطا برمی‌گردد (نه فقط متن ثابت) تا فرانت بتواند دقیقاً
      // نشان دهد چقدر کم دارد — دقیقاً همون الگوی {message, code} که chat.service.ts هم
      // برای خطاهای ساختاریافته استفاده می‌کند
      throw new BadRequestException({
        message: fa.videoEdit.insufficientCredits(
          neededCredits,
          balance.credits,
        ),
        code: 'INSUFFICIENT_CREDITS',
        neededCredits,
        balanceCredits: balance.credits,
      });
    }

    const needsTitle = session.title == null;
    if (needsTitle) {
      await this.prisma.videoEditSession.update({
        where: { id: session.id },
        data: { title: dto.prompt.slice(0, 40) },
      });
    }

    const job = await this.prisma.videoEditJob.create({
      data: schema
        ? {
            userId,
            sessionId: session.id,
            kieVideoModelId: model.id,
            mode: dto.mode,
            prompt: dto.prompt,
            valuesJson: valuesJson as Prisma.InputJsonValue,
          }
        : {
            userId,
            sessionId: session.id,
            kieVideoModelId: model.id,
            mode: dto.mode,
            prompt: dto.prompt,
            referenceImageKeys: dto.referenceImageKeys ?? [],
            videoKey: dto.videoKey ?? null,
            videoWindowStartSec: dto.videoWindowStartSec ?? null,
            videoWindowEndSec: dto.videoWindowEndSec ?? null,
            aspectRatio: dto.aspectRatio ?? '16:9',
            resolution: dto.resolution ?? model.resolutions[0] ?? '720p',
          },
    });

    await this.videoEditQueue.add(
      'render',
      { jobId: job.id },
      { attempts: 1, removeOnComplete: true, removeOnFail: false },
    );

    if (needsTitle) {
      const title = await this.generateSessionTitle(dto.prompt);
      if (title) {
        await this.prisma.videoEditSession.update({
          where: { id: session.id },
          data: { title },
        });
      }
    }

    return job;
  }

  private async generateSessionTitle(prompt: string): Promise<string | null> {
    try {
      const client = this.aiProvider.buildClient();
      const { text } = await generateText({
        model: client(TITLE_GENERATION_MODEL),
        system:
          'بر اساس پرامپت کاربر برای ساخت یا ویرایش ویدیو، یک عنوان کوتاه فارسی ' +
          '(حداکثر ۵ کلمه) بنویس. فقط عنوان، بدون توضیح یا نقل‌قول.',
        prompt: prompt.slice(0, 500),
        maxOutputTokens: 300,
      });
      const title = text.trim().replace(/^["'«»\n]+|["'«»\n]+$/g, '');
      return title || null;
    } catch (err) {
      this.logger.warn(
        `video session title failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async listMyJobs(userId: string) {
    return this.prisma.videoEditJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { kieVideoModel: true },
    });
  }

  private async getOwnedJobOrThrow(userId: string, id: string) {
    const job = await this.prisma.videoEditJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(fa.videoEdit.jobNotFound);
    if (job.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);
    return job;
  }

  async getJobStatus(userId: string, id: string) {
    return this.getOwnedJobOrThrow(userId, id);
  }

  // سرو نتیجه/ویدیوی منبع پشت JwtGuard + چک مالکیت — دقیقاً الگوی امنیتی
  // video-studio.service.ts/getAsset (بدون presigned URL عمومی)
  async getAsset(
    userId: string,
    key: string,
  ): Promise<{ buffer: Buffer; ext: string }> {
    let owned = await this.prisma.videoEditJob.findFirst({
      where: {
        userId,
        OR: [
          { videoKey: key },
          { resultVideoKey: key },
          { referenceImageKeys: { has: key } },
        ],
      },
      select: { id: true },
    });
    // معماری data-driven: کلیدهای فیلدهای image/video/audio/elementGroup داخل valuesJson
    // (به‌جای ستون‌های flat بالا) تودرتو ذخیره می‌شوند — یک ستون flat جدا برای هرکدام معنا
    // ندارد (شکل هر فیلد به schema مدل بستگی دارد)، پس اینجا متن خام JSON را جستجو می‌کنیم
    if (!owned) {
      const candidates = await this.prisma.videoEditJob.findMany({
        where: { userId, valuesJson: { not: Prisma.JsonNull } },
        select: { id: true, valuesJson: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const match = candidates.find((c) => JSON.stringify(c.valuesJson).includes(key));
      if (match) owned = { id: match.id };
    }
    if (!owned) throw new NotFoundException(fa.errors.notFound);
    const ext = key.split('.').pop() ?? 'mp4';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, ext };
  }

  // docs/PRD-video-prompt-coach.md بخش ۳.۳ — این کلیدها هنوز به هیچ jobـی وصل نشده‌اند (بررسی
  // پیش از اولین «تولید ویدیو»)، پس چک مالکیت job-محورِ getAsset این‌جا کاربرد ندارد. کلیدهای
  // MinIO این ماژول UUID تصادفیِ حدس‌نزدنی‌اند و createJob هم از قبل بدون چک اضافه به کلیدهای
  // ورودی کلاینت اعتماد می‌کند — همون سطح اعتماد این‌جا هم تکرار شده، نه یک حفره‌ی جدید.
  //
  // ویدیو برخلاف عکس/صدا نمی‌تواند مستقیم داخل content یک ModelMessage گذاشته شود — تایپ
  // UserContent پکیج «ai» فقط TextPart/ImagePart/FilePart را می‌شناسد، هیچ video part ندارد.
  // به همین دلیل چت اصلی (chat.service.ts) هم ویدیو را از طریق extraUserContentParts/buildClient
  // (تزریق خام روی بادی HTTP، فقط مسیر OpenRouter) می‌فرستد، نه در آرایه‌ی content — همان الگو
  // اینجا هم تکرار شده.
  async reviewPrompt(userId: string, dto: CreatePromptReviewDto) {
    const inlineContentParts: Array<Record<string, unknown>> = [];
    const videoContentParts: Array<Record<string, unknown>> = [];

    for (const asset of dto.referenceAssets ?? []) {
      const buffer = await this.storage.downloadImage(asset.key);
      const ext = asset.key.split('.').pop() ?? 'bin';
      if (asset.type === 'image') {
        const base64 = buffer.toString('base64');
        inlineContentParts.push({
          type: 'image',
          image: `data:image/${ext};base64,${base64}`,
        });
      } else if (asset.type === 'video') {
        const mime = ext === 'mov' ? 'quicktime' : 'mp4';
        const base64 = buffer.toString('base64');
        videoContentParts.push({
          type: 'video_url',
          video_url: { url: `data:video/${mime};base64,${base64}` },
        });
      } else {
        inlineContentParts.push({
          type: 'file',
          data: buffer,
          mediaType: `audio/${ext}`,
          filename: `reference.${ext}`,
        });
      }
    }

    // inlineContentParts (عکس/صدا) فقط به اولین پیام کاربر (messages[0]) چسبانده می‌شود — طبق
    // تصمیم بخش ۱: کلاینت هم فقط در همان اولین درخواست این آرایه را پر می‌فرستد
    const messages: ModelMessage[] = dto.messages.map((m, idx) => {
      if (idx === 0 && m.role === 'user' && inlineContentParts.length) {
        return {
          role: 'user',
          content: [{ type: 'text', text: m.content }, ...inlineContentParts],
        } as unknown as UserModelMessage;
      }
      return { role: m.role, content: m.content };
    });

    try {
      const client = this.aiProvider.buildClient(
        undefined,
        undefined,
        undefined,
        videoContentParts,
      );
      const { text } = await generateText({
        model: client(PROMPT_REVIEW_MODEL),
        system: PROMPT_REVIEW_SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 2000,
      });

      const marker = '---پیشنهاد نهایی---';
      const markerIdx = text.indexOf(marker);
      if (markerIdx === -1) {
        return { critique: text.trim(), suggestedPrompt: null, expectedOutput: null };
      }
      const critique = text.slice(0, markerIdx).trim();
      const afterSuggestion = text.slice(markerIdx + marker.length);

      const expectedMarkerIdx = afterSuggestion.indexOf(EXPECTED_OUTPUT_MARKER);
      if (expectedMarkerIdx === -1) {
        return { critique, suggestedPrompt: afterSuggestion.trim(), expectedOutput: null };
      }
      return {
        critique,
        suggestedPrompt: afterSuggestion.slice(0, expectedMarkerIdx).trim(),
        expectedOutput: afterSuggestion
          .slice(expectedMarkerIdx + EXPECTED_OUTPUT_MARKER.length)
          .trim(),
      };
    } catch (err) {
      this.logger.warn(
        `prompt review failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(fa.videoEdit.promptReviewFailed);
    }
  }
}
