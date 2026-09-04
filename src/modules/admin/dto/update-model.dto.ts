import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  AI_PLATFORMS,
  MODEL_TIERS,
  MODEL_TYPES,
  TOKENIZER_FAMILIES,
} from './create-model.dto';

export class UpdateModelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsIn(MODEL_TYPES)
  modelType?: (typeof MODEL_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputPricePerM?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outputPricePerM?: number;

  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean;

  // docs/PRD-chat-images.md بخش ۵.۵
  @IsOptional()
  @IsBoolean()
  supportsImageGen?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  imageGenInputImagePricePerM?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  imageGenOutputImagePricePerM?: number;

  @IsOptional()
  @IsString()
  imageGenQuality?: string;

  @IsOptional()
  @IsString()
  imageGenSize?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  imageGenFlatPriceUsd?: number;

  @IsOptional()
  @IsIn(['image', 'megapixel'])
  imageGenFlatPriceUnit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  videoGenPricePerSecondUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  videoGenAudioMultiplier?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  videoGenSupportedDurationsSec?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videoGenSupportedSizes?: string[];

  // دستور صریح کاربر — سوییچ ستون «استودیوی ویدیو» توی جدول ادمین از همین DTO (نه CreateModelDto)
  // رد می‌شود چون آپدیت‌های تک‌فیلدی از PATCH استفاده می‌کنند
  @IsOptional()
  @IsBoolean()
  videoStudioEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsIn(MODEL_TIERS)
  tier?: (typeof MODEL_TIERS)[number];

  @IsOptional()
  @IsIn(TOKENIZER_FAMILIES)
  tokenizerFamily?: (typeof TOKENIZER_FAMILIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  avgCharsPerToken?: number;

  // docs/PRD-openrouter-migration.md §۱۳.۴/۱۴.۴ — صفحه‌ی انتخاب مدل بازطراحی‌شده
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  badges?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(AI_PLATFORMS, { each: true })
  platform?: (typeof AI_PLATFORMS)[number][];
}
