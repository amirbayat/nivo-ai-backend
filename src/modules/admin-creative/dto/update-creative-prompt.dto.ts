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
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdateCreativePromptDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(CreativeOutputType)
  outputType?: CreativeOutputType;

  @IsOptional()
  @IsEnum(CreativeSegment)
  segment?: CreativeSegment;

  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  categoryId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  contextMd?: string;

  @IsOptional()
  @IsString()
  userPromptTemplate?: string;

  @IsOptional()
  @IsString()
  exampleImageUrl?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  requiresUserImage?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  creditCost?: number;

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
  @ToNumber()
  sortOrder?: number;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  tags?: string[];
}
