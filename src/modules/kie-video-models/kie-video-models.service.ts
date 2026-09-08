import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { KieVideoCategory, VideoModelProvider } from '@prisma/client';
import type { KieVideoModel } from '@prisma/client';
import { fa } from '../../i18n/fa';

export type CreateKieVideoModelData = Omit<
  KieVideoModel,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateKieVideoModelData = Partial<CreateKieVideoModelData>;

// دقیقاً هم‌الگوی MODEL_IMPORT_COLUMNS در admin.service.ts (import اکسل AiModel) — همون
// قرارداد ستون‌ها/helperهای تبدیل سلول، اینجا برای کاتالوگ ویدیو (KieVideoModel) تکرار شده
const KIE_VIDEO_MODEL_IMPORT_COLUMNS = [
  'provider',
  'slug',
  'displayName',
  'category',
  'isActive',
  'sortOrder',
  'supportsImages',
  'maxImages',
  'supportsVideo',
  'maxVideoDurationSec',
  'maxVideoWindowSec',
  'supportsAspectRatio',
  'supportsDuration',
  'resolutions',
  'pricePerSecondUsdConfirmed',
  'pricingNote',
] as const;

function cellToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function cellToBoolean(value: unknown, fallback: boolean): boolean {
  const s = cellToString(value)?.toLowerCase();
  if (s === undefined) return fallback;
  if (['true', '1', 'yes', 'بله', 'فعال'].includes(s)) return true;
  if (['false', '0', 'no', 'خیر', 'غیرفعال'].includes(s)) return false;
  return fallback;
}

// رزولوشن‌ها با کاما جدا می‌شوند (مثل "480p,720p,1080p") — دقیقاً مثل badges/videoGenSupportedSizes
// در admin.service.ts، تا ادمین بتواند همه‌ی رزولوشن‌های پشتیبانی‌شده‌ی یک مدل را در یک سلول بدهد
function cellToStringArray(value: unknown): string[] | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  return s
    .split(/[,،]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseKieVideoModelImportRow(raw: Record<string, unknown>) {
  return {
    provider: (cellToString(raw.provider)?.toUpperCase() ??
      'KIE') as VideoModelProvider,
    slug: cellToString(raw.slug),
    displayName: cellToString(raw.displayName),
    category: cellToString(raw.category)?.toUpperCase() as
      | KieVideoCategory
      | undefined,
    isActive: cellToBoolean(raw.isActive, true),
    sortOrder: cellToNumber(raw.sortOrder) ?? 0,
    supportsImages: cellToBoolean(raw.supportsImages, false),
    maxImages: cellToNumber(raw.maxImages) ?? null,
    supportsVideo: cellToBoolean(raw.supportsVideo, false),
    maxVideoDurationSec: cellToNumber(raw.maxVideoDurationSec) ?? null,
    maxVideoWindowSec: cellToNumber(raw.maxVideoWindowSec) ?? null,
    supportsAspectRatio: cellToBoolean(raw.supportsAspectRatio, true),
    supportsDuration: cellToBoolean(raw.supportsDuration, true),
    resolutions: cellToStringArray(raw.resolutions) ?? ['720p'],
    pricePerSecondUsdConfirmed:
      cellToNumber(raw.pricePerSecondUsdConfirmed) ?? null,
    pricingNote: cellToString(raw.pricingNote) ?? null,
  };
}

// کاتالوگ مدل‌های ویدیوی Kie.ai — docs/PRD-video-edit-omni-kie.md بخش «مدل داده». عمداً یک
// جدول جدا از AiModel است (نه فقط یک platform جدید روی همان جدول)، چون شکل ورودی این مدل‌ها
// (image_urls/video_list با پنجره‌ی start/end) با فیلدهای عکس/چت‌محور AiModel هم‌خانواده نیست.
@Injectable()
export class KieVideoModelsService {
  constructor(private readonly prisma: PrismaService) {}

  // فرانت/preflight فقط مدل‌های فعال را می‌بینند، مرتب‌شده طبق ترتیب دلخواه ادمین
  async listActive(): Promise<KieVideoModel[]> {
    return this.prisma.kieVideoModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // پنل ادمین همه را می‌بیند، حتی غیرفعال‌ها (برای toggle کردن دوباره)
  async listAll(): Promise<KieVideoModel[]> {
    return this.prisma.kieVideoModel.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getById(id: string): Promise<KieVideoModel> {
    const model = await this.prisma.kieVideoModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException(fa.videoEdit.modelNotFound);
    return model;
  }

  async create(data: CreateKieVideoModelData): Promise<KieVideoModel> {
    return this.prisma.kieVideoModel.create({ data });
  }

  async update(
    id: string,
    data: UpdateKieVideoModelData,
  ): Promise<KieVideoModel> {
    await this.getById(id);
    return this.prisma.kieVideoModel.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    // soft: فقط غیرفعال می‌کنیم، نه حذف واقعی — جاب‌های قدیمی به این مدل foreign key دارند
    // (VideoEditJob.kieVideoModelId، onDelete: RESTRICT عمداً، برای حفظ تاریخچه)
    await this.prisma.kieVideoModel.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // دقیقاً هم‌الگوی AdminService.importModels (اکسل AiModel) — upsert روی slug به‌جای name.
  // برای اضافه‌کردن چند مدل OpenRouter/Kie یک‌جا (به‌جای فرم تک‌ردیفی) طراحی شده.
  async importFromXlsx(buffer: Buffer) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('فایل اکسل قابل خواندن نیست');
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (rows.length === 0) throw new BadRequestException('فایل اکسل خالی است');

    const hasKnownColumn = Object.keys(rows[0]).some((key) =>
      (KIE_VIDEO_MODEL_IMPORT_COLUMNS as readonly string[]).includes(key),
    );
    if (!hasKnownColumn) {
      throw new BadRequestException(
        `فرمت ستون‌های فایل اکسل شناخته نشد. ستون‌های مورد انتظار: ${KIE_VIDEO_MODEL_IMPORT_COLUMNS.join('، ')}`,
      );
    }

    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // ردیف ۱ هدر است
      const data = parseKieVideoModelImportRow(rows[i]);

      if (!data.slug || !data.displayName || !data.category) {
        errors.push({
          row: rowNumber,
          message: 'slug/displayName/category اجباری‌اند',
        });
        continue;
      }
      if (!Object.values(VideoModelProvider).includes(data.provider)) {
        errors.push({
          row: rowNumber,
          message: `provider نامعتبر (باید KIE یا OPENROUTER باشد): ${data.provider}`,
        });
        continue;
      }
      if (!Object.values(KieVideoCategory).includes(data.category)) {
        errors.push({ row: rowNumber, message: `category نامعتبر: ${data.category}` });
        continue;
      }

      try {
        const existing = await this.prisma.kieVideoModel.findUnique({
          where: { slug: data.slug },
        });
        await this.prisma.kieVideoModel.upsert({
          where: { slug: data.slug },
          create: data as CreateKieVideoModelData,
          update: data,
        });
        if (existing) updated++;
        else created++;
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' });
      }
    }

    return { total: rows.length, created, updated, errors };
  }
}
