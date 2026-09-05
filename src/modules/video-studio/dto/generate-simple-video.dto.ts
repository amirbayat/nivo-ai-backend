import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16'] as const;

// فاز اول ساده‌شده‌ی استودیوی ویدیو — دستور صریح کاربر: بدون رفتن از لایه‌ی چت/تشخیص intent،
// کاربر مستقیم متن + عکس اختیاری + مدل + سایز می‌دهد و یک ویدیو تولید می‌شود
// (video-studio.service.ts/generateSimpleVideo).
export class GenerateSimpleVideoDto {
  @IsString()
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  prompt: string;

  // کلید MinIO عکس مرجع، از POST /video-studio/upload-image
  @IsOptional()
  @IsString()
  imageKey?: string;

  // نام مدل VIDEO_GEN (همان چیزی که project.videoModelId/resolveModel هم استفاده می‌کنند)
  @IsString()
  videoModelId: string;

  @IsIn(ASPECT_RATIOS)
  videoAspectRatio: (typeof ASPECT_RATIOS)[number];

  @IsOptional()
  @IsBoolean()
  audioEnabled?: boolean;

  // اختیاری — نبود آن یعنی رفتار قبلی (اولین مقدار پشتیبانی‌شده‌ی مدل). باید عضو
  // videoGenSupportedDurationsSec مدل انتخابی باشد؛ چون این لیست به‌ازای هر مدل فرق می‌کند،
  // چک واقعی در video-studio.service.ts/generateSimpleVideo انجام می‌شود، نه اینجا با @IsIn ثابت
  @IsOptional()
  @IsInt()
  videoDurationSec?: number;
}
