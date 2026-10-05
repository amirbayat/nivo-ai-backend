import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export enum NotesAnalysisEntityType {
  STORE = 'STORE',
  PRODUCT = 'PRODUCT',
}

// docs/PRD-seller-guide-assistant-modal.md بخش ۱.۲ — ورودی تحلیل یادداشت خام فروشنده.
// rawText اختیاری است: برای دکمه‌ی «تحلیل دوباره» خالی می‌ماند (چیزی append نمی‌شود، فقط
// ownerNotes فعلی دوباره تحلیل می‌شود)
export class AnalyzeOwnerNotesDto {
  @IsEnum(NotesAnalysisEntityType, { message: fa.validation.required })
  entityType: NotesAnalysisEntityType;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000, { message: fa.validation.stringTooLong })
  rawText?: string;
}
