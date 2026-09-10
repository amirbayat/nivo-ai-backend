import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Prisma, VideoJobStatus, type KieVideoModel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { PricingService } from '../usage/pricing.service';
import { CreditsService } from '../credits/credits.service';
import { KieVideoModelsService } from '../kie-video-models/kie-video-models.service';
import { VideoEditConfigService } from '../video-edit-config/video-edit-config.service';
import { CreateVideoEditJobDto } from './dto/create-video-edit-job.dto';
import { fa } from '../../i18n/fa';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly pricing: PricingService,
    private readonly credits: CreditsService,
    private readonly kieModels: KieVideoModelsService,
    private readonly videoEditConfig: VideoEditConfigService,
    @InjectQueue('video-edit')
    private readonly videoEditQueue: Queue,
  ) {}

  async listModels() {
    return this.kieModels.listActive();
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
  ): Promise<{ key: string; durationSec: number }> {
    if (!file) throw new BadRequestException(fa.videoEdit.noFileUploaded);
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    const ext = ALLOWED_VIDEO_MIME_EXT[file.mimetype];
    if (!ext || !matchesVideoMagicBytes(file.buffer)) {
      throw new BadRequestException(fa.videoEdit.invalidVideoFormat);
    }
    const durationSec = await this.mediaTranscode.getVideoDuration(
      file.buffer,
      ext,
    );
    const key = await this.storage.uploadImage(file.buffer, ext);
    return { key, durationSec };
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
      estimateDurationSec * (model.pricePerSecondUsdConfirmed ?? 0.1);
    const estimate = await this.pricing.calcFlatCostToman(estimateUsd);
    // «نیوو» واحد نمایشی-به-کاربر است (بخش کامنت CreditsService)، نه تومان خام — کاربر
    // صریحاً خواست پیام خطا هم با همین واحد باشد، نه تومان
    const balance = await this.credits.getBalance(userId);
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

    // اولین job یک session بی‌عنوان → عنوان از ۴۰ کاراکتر اول همین پرامپت (دقیقاً الگوی
    // backfill در manual-migrations/20260908b — کاربر هیچ فرم «تغییر نام» جداگانه نمی‌بیند)
    if (session.title == null) {
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
            aspectRatio: dto.videoKey ? null : (dto.aspectRatio ?? '16:9'),
            resolution: dto.resolution ?? model.resolutions[0] ?? '720p',
          },
    });

    await this.videoEditQueue.add(
      'render',
      { jobId: job.id },
      { attempts: 1, removeOnComplete: true, removeOnFail: false },
    );

    return job;
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
}
