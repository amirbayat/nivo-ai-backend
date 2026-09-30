import { ArrayMaxSize, IsArray, IsUrl } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-seller-knowledge-base.md بخش ۲.۵ — تصاویر پیشنهادی همان صفحه (imageUrls)، فقط
// وقتی فروشنده صریحاً تأیید کرد دانلود و به استوریج خودمان آپلود می‌شوند
export class AddProductImagesFromUrlDto {
  @IsArray({ message: fa.validation.required })
  @ArrayMaxSize(4, { message: fa.store.tooManyImages })
  @IsUrl({}, { each: true, message: fa.validation.required })
  urls: string[];
}
