import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// فیدبک کاربر ۱۴۰۵/۰۷/۱۱ — فروشنده یادداشت خام درباره‌ی محصول می‌نویسد، همین یادداشت به
// generateProductDescriptionFromNotes می‌رود تا به یک توضیح Markdown تمیز تبدیل شود (عیناً
// الگوی GenerateBrandIntroDto)
export class GenerateProductDescriptionDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.productNotesRequired })
  @MaxLength(4000, { message: fa.validation.stringTooLong })
  rawText: string;
}
