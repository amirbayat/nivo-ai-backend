import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CreativeSegment } from '@prisma/client';
import { fa } from '../../../i18n/fa';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: fa.validation.stringTooLong })
  name?: string;

  @IsOptional()
  @IsEnum(CreativeSegment)
  platform?: CreativeSegment;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: fa.validation.stringTooLong })
  niche?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: fa.validation.stringTooLong })
  contextMd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: fa.validation.stringTooLong })
  brandColor?: string;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive?: boolean;

  @IsOptional()
  @IsString()
  pinnedPromptId?: string;
}
