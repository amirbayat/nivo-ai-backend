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

  // فقط معنادار وقتی videoKey خالی است (بخش ۲.۲ سند)
  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio?: (typeof ASPECT_RATIOS)[number];
}
