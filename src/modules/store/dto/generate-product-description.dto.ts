import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// فیدبک کاربر ۱۴۰۵/۰۷/۱۱ — فروشنده یادداشت خام درباره‌ی محصول می‌نویسد، همین یادداشت به
// generateProductDescriptionFromNotes می‌رود تا به یک توضیح Markdown تمیز تبدیل شود (عیناً
// الگوی GenerateBrandIntroDto)
export class GenerateProductDescriptionDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.productNotesRequired })
  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — سقف قبلی (۴۰۰۰) حتی کوچک‌تر از DESCRIPTION_MAX_LENGTH خودِ
  // محصول (۵۰۰۰) بود؛ مدل (gpt-5.4-mini) پنجره‌ی ورودی بسیار بزرگ‌تری دارد، این سقف فقط
  // جلوی پیست تصادفی حجم غیرمعقول را می‌گیرد، نه محدودیت واقعی مدل
  @MaxLength(10000, { message: fa.validation.stringTooLong })
  rawText: string;
}
