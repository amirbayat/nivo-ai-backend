import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-daily-content-prompt-agent.md — بدنه‌ی POST /content-agent/images. فقط برای
// میزبانی عمومیِ عکس‌هایی که از قبل روی سیستم کاربر (مثلاً با GPT Image از طریق OpenRouter)
// ساخته شده‌اند تا در contentMd مقاله‌ها/پرامپت‌ها لینک داده شوند — بدون رندر/تولید سمت سرور.
export class CreateAgentImageDto {
  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  imageBase64!: string;

  @IsOptional()
  @IsIn(['png', 'jpg', 'jpeg', 'webp'])
  ext?: 'png' | 'jpg' | 'jpeg' | 'webp';
}
