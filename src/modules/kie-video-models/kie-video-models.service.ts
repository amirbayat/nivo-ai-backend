import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { KieVideoCategory, Prisma, VideoModelProvider } from '@prisma/client';
import type { KieVideoModel } from '@prisma/client';
import { fa } from '../../i18n/fa';
import { parseInputFields, safeParseInputFields, type InputFieldsSchema } from './input-fields.schema';

// inputFields عمداً unknown است، نه InputFieldsSchema — از کنترلر (DTO) خام می‌رسد و فقط
// داخل create/update/importFromXlsx همین سرویس با parseInputFields اعتبارسنجی می‌شود
export type CreateKieVideoModelData = Omit<
  KieVideoModel,
  'id' | 'createdAt' | 'updatedAt' | 'inputFields'
> & { inputFields?: unknown };
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
  'inputFields', // JSON رشته‌ای، طبق input-fields.schema.ts — ستون خالی یعنی «دست‌نخورده بماند»
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

// ستون inputFields خالی یعنی «دست‌نخورده بماند» (undefined، نه null) — چون بیشتر ردیف‌های
// اکسل هنوز این ستون را پر نکرده‌اند و نباید یک ایمپورت جزئی (مثلاً فقط برای آپدیت قیمت)
// عمداً inputFields مدل‌های قبلاً کامل‌شده را null کند
function cellToJsonInputFields(value: unknown): { value?: InputFieldsSchema | null; error?: string } {
  const s = cellToString(value);
  if (s === undefined) return { value: undefined };
  if (s.toLowerCase() === 'null') return { value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { error: 'JSON قابل‌پارس نیست' };
  }
  const result = safeParseInputFields(parsed);
  return result.error ? { error: result.error } : { value: result.data };
}

function parseKieVideoModelImportRow(raw: Record<string, unknown>) {
  const inputFieldsCell = cellToJsonInputFields(raw.inputFields);
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
    inputFields: inputFieldsCell.value,
    inputFieldsError: inputFieldsCell.error,
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
    const models = await this.prisma.kieVideoModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return models.map((m) => this.withSanitizedInputFields(m));
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
    return this.withSanitizedInputFields(model);
  }

  private withSanitizedInputFields(model: KieVideoModel): KieVideoModel {
    if (model.inputFields == null) return model;
    const parsed = safeParseInputFields(model.inputFields);
    if (!parsed.data) return model;
    return {
      ...model,
      inputFields: parsed.data as unknown as Prisma.JsonValue,
    };
  }

  // Prisma نمی‌گذارد null خام را مستقیم به یک ستون Json بدهیم (باید Prisma.JsonNull باشد)؛
  // undefined یعنی «این فیلد اصلاً در payload نباشد» (create: پیش‌فرض دیتابیس، update: دست‌نخورده)
  private toPrismaInputFields(
    value: InputFieldsSchema | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value as unknown as Prisma.InputJsonValue;
  }

  async create(data: CreateKieVideoModelData): Promise<KieVideoModel> {
    const { inputFields, ...rest } = data;
    const validated = inputFields != null ? parseInputFields(inputFields) : inputFields;
    return this.prisma.kieVideoModel.create({
      data: { ...rest, inputFields: this.toPrismaInputFields(validated) },
    });
  }

  async update(
    id: string,
    data: UpdateKieVideoModelData,
  ): Promise<KieVideoModel> {
    await this.getById(id);
    const { inputFields, ...rest } = data;
    const validated = inputFields != null ? parseInputFields(inputFields) : inputFields;
    return this.prisma.kieVideoModel.update({
      where: { id },
      data: { ...rest, inputFields: this.toPrismaInputFields(validated) },
    });
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
      if (data.inputFieldsError) {
        errors.push({ row: rowNumber, message: `ستون inputFields نامعتبر: ${data.inputFieldsError}` });
        continue;
      }

      const { inputFieldsError: _inputFieldsError, ...rowData } = data;
      try {
        const existing = await this.prisma.kieVideoModel.findUnique({
          where: { slug: rowData.slug },
        });
        const inputFieldsForWrite = this.toPrismaInputFields(rowData.inputFields);
        await this.prisma.kieVideoModel.upsert({
          where: { slug: rowData.slug },
          create: { ...rowData, inputFields: inputFieldsForWrite } as Prisma.KieVideoModelCreateInput,
          update: { ...rowData, inputFields: inputFieldsForWrite },
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
