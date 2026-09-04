import { IsIn, IsOptional, IsString } from 'class-validator';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16'] as const;

// انتخاب‌های همیشه‌در‌دسترس کاربر (نه بخشی از یک wizard) — چیپ‌های مدل چت/عکس/ویدیو + ابعاد،
// طبق docs/PRD-video-studio-chat-flow.md §۲. هر فیلد مستقل قابل‌تنظیم است؛ فقط فیلدهای
// فرستاده‌شده آپدیت می‌شوند.
export class SetVideoStudioModelsDto {
  @IsOptional()
  @IsString()
  chatModelId?: string;

  @IsOptional()
  @IsString()
  photoModelId?: string;

  @IsOptional()
  @IsString()
  videoModelId?: string;

  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  imageAspectRatio?: (typeof ASPECT_RATIOS)[number];

  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  videoAspectRatio?: (typeof ASPECT_RATIOS)[number];
}
