import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreativeSegment } from '@prisma/client';
import { fa } from '../../../i18n/fa';

// پروژه = پیج اینستاگرام/کانال یوتیوب کاربر — بخش ۵.۹ سند فنی. فقط سه مقدار
// از CreativeSegment برای «پلتفرم پروژه» معنا دارد (BUSINESS برای دسته‌ی سبک‌هاست، نه پروژه)
export class CreateProjectDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  name: string;

  @IsEnum(CreativeSegment, { message: fa.validation.required })
  platform: CreativeSegment;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: fa.validation.stringTooLong })
  niche?: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(4000, { message: fa.validation.stringTooLong })
  contextMd: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: fa.validation.stringTooLong })
  brandColor?: string;
}
