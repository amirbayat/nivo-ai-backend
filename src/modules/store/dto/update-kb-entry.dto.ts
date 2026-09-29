import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StoreKbKind } from '@prisma/client';
import { fa } from '../../../i18n/fa';

export class UpdateKbEntryDto {
  @IsOptional()
  @IsEnum(StoreKbKind, { message: fa.validation.required })
  kind?: StoreKbKind;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(500, { message: fa.validation.stringTooLong })
  question?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(5000, { message: fa.validation.stringTooLong })
  answer?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
