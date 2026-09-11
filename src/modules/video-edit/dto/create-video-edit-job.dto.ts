import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VideoEditMode } from '@prisma/client';
import { fa } from '../../../i18n/fa';

const MODES = Object.values(VideoEditMode);
const ASPECT_RATIOS = ['16:9', '9:16'] as const;

// docs/PRD-video-edit-omni-kie.md بخش ۲ — GENERATE و EDIT یک endpoint واحد Kie می‌زنند؛
// اعتبارسنجی مخصوص هر mode (مثلاً EDIT بدون عکس، videoKey اجباری) در video-edit.service.ts
// انجام می‌شود، نه اینجا با دکوریتورهای ثابت — چون این قوانین به‌ازای مدل کاتالوگ هم فرق می‌کند
export class CreateVideoEditJobDto {
  // اختیاری — اگر نیاید، یک VideoEditSession تازه (بی‌عنوان) ساخته می‌شود (بازطراحی ۱۴۰۵/۰۶/۱۷:
  // «شروع ویرایش جدید»)؛ اگر بیاید باید مال همین کاربر باشد (چک در video-edit.service.ts)
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsIn(MODES)
  mode: VideoEditMode;

  @IsString()
  kieVideoModelId: string;

  @IsString()
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  prompt: string;

  // فقط GENERATE — کلیدهای MinIO از POST /video-edit/upload-image
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceImageKeys?: string[];

  // GENERATE: مرجع اختیاری؛ EDIT: منبع اجباری — کلید MinIO از POST /video-edit/upload-video
  @IsOptional()
  @IsString()
  videoKey?: string;

  @IsOptional()
  @IsNumber()
  videoWindowStartSec?: number;

  @IsOptional()
  @IsNumber()
  videoWindowEndSec?: number;

  // فقط معنادار برای مدل‌هایی که فیلد aspect_ratio دارند — با ویدیوی منبع هم ارسال می‌شود
  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio?: (typeof ASPECT_RATIOS)[number];

  // اختیاری — باید یکی از model.resolutions باشد (اعتبارسنجی در video-edit.service.ts، چون
  // مقادیر مجاز به‌ازای هر مدل فرق می‌کند)؛ اگر نیاید، اولین رزولوشن کاتالوگ مدل استفاده می‌شود
  @IsOptional()
  @IsString()
  resolution?: string;

  // معماری data-driven (kieVideoModel.inputFields غیر-null): values-by-field-key که فرم عمومی
  // فرانت می‌سازد — جایگزین referenceImageKeys/videoKey/.../resolution بالا برای این مدل‌ها.
  // شکل دقیق مقدار هر کلید به type همان field در inputFields بستگی دارد (رجوع کن به کامنت
  // FieldValues در generic-payload-builder.ts). ساختار عمیق/متغیر است، پس اینجا فقط unknown —
  // اعتبارسنجی واقعی با validateInputValues داخل VideoEditService انجام می‌شود.
  @IsOptional()
  valuesJson?: Record<string, unknown>;
}
