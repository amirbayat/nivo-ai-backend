import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ListConversationsDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @Max(50, { message: fa.validation.stringTooLong })
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  projectId?: string;

  // docs/PRD-openrouter-migration.md §۱۴.۵ بند ۳ — تاریخچه‌ی استودیوی عکس (ImageStudioHistory):
  // فیلتر روی همون Conversation.imageGenCount موجود، نه یک entity/endpoint جدا
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: fa.validation.required })
  imageGenOnly?: boolean;
}
