import { Type } from 'class-transformer';
import {
  IsBoolean,
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

  // توضیح کوتاه کاربرپسند — جدا از contextMd (که به سیستم‌پرامپت تولید اضافه می‌شود، نه UI)
  @IsOptional()
  @IsString()
  description?: string;

  // نام AiModel پیشنهادی — برای isFreeformPrompt=true فقط پیش‌انتخاب چیپ مدل در کامپوزر است، قفل نیست
  @IsOptional()
  @IsString()
  preferredModel?: string;

  // true یعنی «استفاده» فقط promptText را عیناً توی composer آزاد می‌ریزد، بدون قفل‌شدن مدل/فلوی سبک
  @IsOptional()
  @IsBoolean()
  isFreeformPrompt?: boolean;
}
