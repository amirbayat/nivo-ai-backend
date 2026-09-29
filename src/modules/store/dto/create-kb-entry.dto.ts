import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StoreKbKind } from '@prisma/client';
import { fa } from '../../../i18n/fa';

// docs/PRD-seller-knowledge-base.md بخش ۳.۲ — افزودن دستی به باکس دانش
export class CreateKbEntryDto {
  @IsEnum(StoreKbKind, { message: fa.validation.required })
  kind: StoreKbKind;

  @IsString({ message: fa.validation.required })
  @MaxLength(500, { message: fa.validation.stringTooLong })
  question: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(5000, { message: fa.validation.stringTooLong })
  answer: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  relatedProductId?: string;
}
