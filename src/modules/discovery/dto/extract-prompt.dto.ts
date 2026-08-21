import { IsIn, IsOptional, IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

// کلید MinIO عکسی که قبلاً با POST /v2/discovery/upload-image آپلود شده — همان کلید
// اینجا برای «تبدیل عکس به پرامپت» دوباره استفاده می‌شود
export class ExtractPromptDto {
  @IsString({ message: fa.validation.required })
  imageKey: string;

  // انتخاب دستی مدل (AiModel.name) — اگر خالی باشد، بر اساس selectionMode خودکار انتخاب می‌شود
  @IsOptional()
  @IsString()
  modelId?: string;

  // فقط وقتی modelId خالی است اثر دارد — دو حالت خودکار «مصرف بهینه»/«بهترین نتیجه»
  // (docs/PRD-model-selection-modes.md) — پیش‌فرض 'best_answer'
  @IsOptional()
  @IsIn(['cost_optimized', 'best_answer'])
  selectionMode?: 'cost_optimized' | 'best_answer';
}
