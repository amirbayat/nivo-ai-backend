import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CreativeOutputType, CreativeSegment } from '@prisma/client';
import { fa } from '../../../i18n/fa';

// ادمین از این‌جا سبک‌های آماده‌ی دیسکاوری را می‌سازد — عکس یا متن، با context اختصاصی
// (بخش ۵.۷ سند فنی: «توی ادمین هم بیار که بتونیم context بدیم برای تولید سبک‌های مختلف»)
export class CreateCreativePromptDto {
  @IsString({ message: fa.validation.required })
  title: string;

  @IsEnum(CreativeOutputType, { message: fa.validation.required })
  outputType: CreativeOutputType;

  @IsOptional()
  @IsEnum(CreativeSegment, { message: fa.validation.required })
  segment?: CreativeSegment;

  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  categoryId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString({ message: fa.validation.required })
  contextMd: string;

  @IsString({ message: fa.validation.required })
  userPromptTemplate: string;

  @IsOptional()
  @IsString()
  exampleImageUrl?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  requiresUserImage?: boolean;

  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  creditCost: number;

  @IsOptional()
  @IsString()
  preferredModel?: string;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isTrending?: boolean;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  tags?: string[];
}
