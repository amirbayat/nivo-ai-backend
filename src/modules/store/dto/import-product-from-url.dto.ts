import { IsUrl } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-seller-knowledge-base.md بخش ۲.۵ — ورود سریع محصول از لینک صفحه‌ی موجود
export class ImportProductFromUrlDto {
  @IsUrl({}, { message: fa.validation.required })
  url: string;
}
