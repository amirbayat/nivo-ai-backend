import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-daily-content-prompt-agent.md بخش ۵.۲ — بدنه‌ی POST /content-agent/prompts.
// فاز ۱ فقط IMAGE است — CreativeOutputType هنوز VIDEO ندارد و استودیوی ویدیو اصلاً promptId
// نمی‌شناسد؛ پرامپت‌های ویدیو فاز ۲ هستند (تصمیم کاربر).
export class CreateAgentPromptDto {
  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  title!: string;

  @IsIn(['IMAGE'], { message: 'فعلاً فقط پرامپت عکس پشتیبانی می‌شود' })
  outputType!: 'IMAGE';

  @IsString({ message: fa.validation.required })
  promptText!: string;

  @IsString({ message: fa.validation.required })
  sourceUrl!: string;

  @IsString({ message: fa.validation.required })
  categoryId!: string;

  @IsOptional()
  @IsString()
  referenceImageUrl?: string;

  @IsOptional()
  @IsString()
  contextMd?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  creditCost!: number;
}
