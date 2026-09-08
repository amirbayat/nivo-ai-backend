import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { KieVideoCategory, VideoModelProvider } from '@prisma/client';

const CATEGORIES = Object.values(KieVideoCategory);
const PROVIDERS = Object.values(VideoModelProvider);

// برای هر دو create/update استفاده می‌شود — همه‌ی فیلدها اینجا اختیاری‌اند، سرویس تصمیم
// می‌گیرد کدام‌ها برای create اجباری‌اند (slug/displayName/category)
export class UpsertKieVideoModelDto {
  // پیش‌فرض KIE در کنترلر اعمال می‌شود (نه اینجا) تا این DTO برای update هم قابل‌استفاده بماند
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: VideoModelProvider;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KieVideoCategory;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  supportsImages?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxImages?: number;

  @IsOptional()
  @IsBoolean()
  supportsVideo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxVideoDurationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxVideoWindowSec?: number;

  @IsOptional()
  @IsBoolean()
  supportsAspectRatio?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsDuration?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resolutions?: string[];

  @IsOptional()
  pricePerSecondUsdConfirmed?: number;

  @IsOptional()
  @IsString()
  pricingNote?: string;
}
