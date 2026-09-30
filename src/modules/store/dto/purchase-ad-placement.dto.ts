import { IsIn } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-seller-advertising-placements.md بخش ۳ — فقط دو بازه‌ی ثابت، عمداً بدون مزایده
export class PurchaseAdPlacementDto {
  @IsIn([7, 30], { message: fa.validation.required })
  durationDays: 7 | 30;
}
