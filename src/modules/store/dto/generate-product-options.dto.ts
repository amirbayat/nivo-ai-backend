import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-product-display-focus-and-variations.md §۴.۱.۱ (فاز ۲) — فروشنده توضیح متنی آزاد
// درباره‌ی گزینه‌های محصول می‌نویسد (مثل کپشن اینستاگرام)، همین متن به
// generateProductOptionsFromText می‌رود (عیناً الگوی GenerateProductDescriptionDto)
export class GenerateProductOptionsDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.variantOptionsTextRequired })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  rawText: string;
}
