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
import { ToNumber } from '../../../common/decorators/digits.decorators';

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
  @ToNumber()
  inputPricePerM?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ToNumber()
  outputPricePerM?: number;

  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean;

  // docs/PRD-chat-images.md بخش ۵.۵
  @IsOptional()
  @IsBoolean()
  supportsImageGen?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsWebSearch?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsFileInput?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsVideoInput?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsAudioInput?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ToNumber()
  imageGenInputImagePricePerM?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ToNumber()
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
  @ToNumber()
  imageGenFlatPriceUsd?: number;

  @IsOptional()
  @IsIn(['image', 'megapixel'])
  imageGenFlatPriceUnit?: string;

  @IsOptional()
  @IsBoolean()
  imageGenUseDirectApi?: boolean;

  @IsOptional()
  @IsBoolean()
  imageGenRequiresInputImage?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ToNumber()
  videoGenPricePerSecondUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ToNumber()
  videoGenAudioMultiplier?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @ToNumber()
  videoGenSupportedDurationsSec?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videoGenSupportedSizes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @ToNumber()
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
  @ToNumber()
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
