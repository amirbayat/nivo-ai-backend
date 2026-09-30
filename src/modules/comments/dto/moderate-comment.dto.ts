import { IsIn } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-customer-comments-and-discounts.md بخش الف/۵ — تصمیم نهایی ادمین، فقط این دو مقدار
export class ModerateCommentDto {
  @IsIn(['ADMIN_APPROVED', 'ADMIN_REJECTED'], {
    message: fa.validation.required,
  })
  status: 'ADMIN_APPROVED' | 'ADMIN_REJECTED';
}
