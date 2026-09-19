import { IsOptional, IsString, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// PATCH /content-agent/articles/:slug — ویرایش مقاله‌ای که قبلاً با همین ایجنت
// ساخته شده (مثلاً برای اضافه‌کردن coverImageUrl/عکس‌های داخل متن بعد از انتشار).
export class UpdateAgentArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: fa.validation.required })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: fa.validation.required })
  summaryMd?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;
}
