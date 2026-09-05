import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { CaptionProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PricingService } from '../usage/pricing.service';
import { CaptionPricingService } from '../usage/caption-pricing.service';
import { CreditsService } from '../credits/credits.service';
import { UpdateCaptionProjectDto } from './dto/update-caption-project.dto';
import { fa } from '../../i18n/fa';
import {
  buildAssSubtitle,
  buildDefaultSegments,
  type CaptionSegment,
  type CaptionStyleOverrides,
  type CaptionWord,
} from '../../common/services/ass-subtitle-builder';
import { buildSrt, buildVtt } from '../../common/services/subtitle-export';

const EXPORT_FORMATS = ['srt', 'vtt', 'ass'] as const;
export type SubtitleExportFormat = (typeof EXPORT_FORMATS)[number];
// نمای اولیه‌ی ASS برای export مستقل (بدون دانلود کامل ویدیو فقط برای ابعاد واقعی) — کاربرد
// اصلی این فایل باز کردن در ادیتورهای دیگر (Premiere/CapCut) است که خودشان canvas را
// می‌شناسند؛ برای رندر نهایی (بخش ۵.۱) از ابعاد واقعی ویدیو استفاده می‌شود، نه این‌جا.
const DEFAULT_EXPORT_WIDTH = 1280;
const DEFAULT_EXPORT_HEIGHT = 720;

// فرمت‌های مجاز آپلود ویدیوی مبدأ — mp4 (استاندارد) و mov (فرمت پیش‌فرض دوربین آیفون)،
// docs/PRD-video-auto-captions.md §۷. تشخیص با magic bytes، نه فقط mimetype ادعایی کلاینت
// (همون الگوی امنیتی chat-image.validator.ts) — هر دو فرمت روی همون کانتینر ISO-BMFF هستند،
// امضای مشترک "ftyp" در بایت ۴ تا ۸.
const ALLOWED_VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

function matchesVideoMagicBytes(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

// سقف محصول ۲۰ دقیقه (docs/PRD-video-auto-captions.md §۱۰/§۱۴) — چک نهایی/دقیق روی
// sourceDurationSec واقعی بعد از ASR انجام می‌شود (پردازشگر صف)؛ این‌جا فقط یک سقف حجمی
// محافظه‌کارانه برای رد سریع فایل‌های آشکارا خیلی بزرگ، پیش از صف‌شدن job
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // ۵۰۰ مگابایت

@Injectable()
export class CaptionStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly captionPricing: CaptionPricingService,
    private readonly credits: CreditsService,
    @InjectQueue('caption-transcribe')
    private readonly transcribeQueue: Queue,
    @InjectQueue('caption-render')
    private readonly renderQueue: Queue,
  ) {}

  private async enqueueTranscribe(captionProjectId: string) {
    await this.transcribeQueue.add(
      'transcribe',
      { captionProjectId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async createProject(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException(fa.captionStudio.noFileUploaded);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(fa.captionStudio.fileTooLarge);
    }

    const ext = ALLOWED_VIDEO_MIME_EXT[file.mimetype];
    if (!ext || !matchesVideoMagicBytes(file.buffer)) {
      throw new BadRequestException(fa.captionStudio.invalidVideoFormat);
    }

    const sourceVideoKey = await this.storage.uploadImage(file.buffer, ext);

    const project = await this.prisma.captionProject.create({
      data: {
        userId,
        sourceVideoKey,
        status: CaptionProjectStatus.UPLOADED,
      },
    });

    await this.enqueueTranscribe(project.id);

    return project;
  }

  private async findOwnedProject(userId: string, id: string) {
    const project = await this.prisma.captionProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException(fa.captionStudio.projectNotFound);
    if (project.userId !== userId) throw new ForbiddenException();
    return project;
  }

  async getProject(userId: string, id: string) {
    return this.findOwnedProject(userId, id);
  }

  // برای <video src="/caption-studio/assets/...">‌های فرانت (ویدیوی مبدأ یا رندرشده) — کلید
  // MinIO مستقیم عمومی نیست (مثل video-studio.service.ts/getAsset)، پس مالکیت باید صریح چک
  // شود. Range پشتیبانی می‌شود تا پخش/seek ویدیوهای بلند (تا ۲۰ دقیقه) نیاز به دانلود کامل
  // پیش از شروع نداشته باشد.
  async getAssetStream(
    userId: string,
    key: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Awaited<ReturnType<StorageService['getObjectStream']>>;
    ext: string;
    size: number;
    range: { start: number; end: number } | null;
  }> {
    const owned = await this.prisma.captionProject.findFirst({
      where: { userId, OR: [{ sourceVideoKey: key }, { renderedVideoKey: key }] },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException(fa.captionStudio.projectNotFound);

    const ext = key.split('.').pop() ?? 'mp4';
    const stat = await this.storage.statObject(key);
    const size = stat.size;

    const match = rangeHeader ? /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      const stream = await this.storage.getObjectStream(key, { start, end });
      return { stream, ext, size, range: { start, end } };
    }

    const stream = await this.storage.getObjectStream(key);
    return { stream, ext, size, range: null };
  }

  async updateProject(userId: string, id: string, dto: UpdateCaptionProjectDto) {
    await this.findOwnedProject(userId, id);
    return this.prisma.captionProject.update({
      where: { id },
      data: {
        ...(dto.segments !== undefined ? { segments: dto.segments as unknown as object } : {}),
        ...(dto.styleId !== undefined ? { styleId: dto.styleId } : {}),
        ...(dto.styleOverrides !== undefined
          ? { styleOverrides: dto.styleOverrides as unknown as object }
          : {}),
      },
    });
  }

  // خروجی فایل زیرنویس خام (بخش ۸.۲) — جدا از نسخه‌ی سوزانده‌شده؛ هر سه فرمت از همون
  // segments مشترک ساخته می‌شوند (اگر کاربر هنوز ادیت نکرده، از transcriptWords خام گروه‌بندی می‌شود)
  async exportSubtitles(
    userId: string,
    id: string,
    format: SubtitleExportFormat,
  ): Promise<{ content: string; mime: string; ext: string }> {
    const project = await this.findOwnedProject(userId, id);
    const segments =
      (project.segments as unknown as CaptionSegment[] | null) ??
      buildDefaultSegments((project.transcriptWords as unknown as CaptionWord[] | null) ?? []);

    if (format === 'srt') return { content: buildSrt(segments), mime: 'application/x-subrip', ext: 'srt' };
    if (format === 'vtt') return { content: buildVtt(segments), mime: 'text/vtt', ext: 'vtt' };
    return {
      content: buildAssSubtitle(
        segments,
        project.styleOverrides as unknown as CaptionStyleOverrides | null,
        DEFAULT_EXPORT_WIDTH,
        DEFAULT_EXPORT_HEIGHT,
      ),
      mime: 'text/plain',
      ext: 'ass',
    };
  }

  // شروع رندر نهایی (بخش ۱۴.۴) — پیش‌چک موجودی قبل از صف‌شدن job، دقیقاً الگوی
  // nivo-cal.service.ts scan (قیمت ثابت، نه هزینه‌محور؛ کسر واقعی فقط بعد از موفقیت
  // در caption-render.processor.ts رخ می‌دهد)
  async startRender(userId: string, id: string) {
    const project = await this.findOwnedProject(userId, id);
    if (
      project.status !== CaptionProjectStatus.READY_FOR_EDIT &&
      project.status !== CaptionProjectStatus.DONE
    ) {
      throw new BadRequestException(fa.captionStudio.notReadyForRender);
    }

    const creditCost = await this.captionPricing.getCreditCost(project.sourceDurationSec ?? 0);
    const creditConfig = await this.credits.getConfig();
    const precheckToman = creditCost * creditConfig.tomanPerCredit;
    const walletBalance = await this.pricing.getWalletBalance(userId);
    if (walletBalance < precheckToman) {
      throw new BadRequestException(fa.captionStudio.insufficientCredits);
    }

    await this.prisma.captionProject.update({
      where: { id },
      data: { status: CaptionProjectStatus.RENDERING },
    });

    await this.renderQueue.add(
      'render',
      { captionProjectId: id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return this.prisma.captionProject.findUnique({ where: { id } });
  }

  // دکمه‌ی «تلاش دوباره» صریح (docs/PRD-video-auto-captions.md §۱۶.۴) — چون هیچ فیچر مشابهی
  // در این پروژه retry خودکار ندارد، کاربر باید بتواند برای یک پروژه‌ی FAILED دستی درخواست بدهد
  async retryTranscription(userId: string, id: string) {
    const project = await this.findOwnedProject(userId, id);
    if (project.status !== CaptionProjectStatus.FAILED) {
      throw new BadRequestException(fa.captionStudio.onlyFailedCanRetry);
    }
    await this.prisma.captionProject.update({
      where: { id },
      data: { status: CaptionProjectStatus.UPLOADED },
    });
    await this.enqueueTranscribe(id);
    return this.prisma.captionProject.findUnique({ where: { id } });
  }
}
