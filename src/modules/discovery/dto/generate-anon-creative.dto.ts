import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// امتحان رایگان یک‌باره‌ی تولید دیسکاوری برای کاربر مهمان — مثل GenerateCreativeDto ولی بدون
// projectId (کاربر مهمان پروژه ندارد)
export class GenerateAnonCreativeDto {
  @IsUUID(undefined, { message: fa.validation.required })
  promptId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  userInput?: string;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  inputImageKeys?: string[];

  // مثل GenerateCreativeDto.preserveFace — پیش‌فرض روشن
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  preserveFace?: boolean;
}
