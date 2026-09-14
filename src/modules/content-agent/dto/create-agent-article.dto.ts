import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-daily-content-prompt-agent.md بخش ۵.۱ — بدنه‌ی POST /content-agent/articles
export class CreateAgentArticleDto {
  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  title!: string;

  @IsString({ message: fa.validation.required })
  summaryMd!: string;

  @IsString({ message: fa.validation.required })
  sourceUrl!: string;

  @IsString({ message: fa.validation.required })
  sourceName!: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  publishNow?: boolean;
}
