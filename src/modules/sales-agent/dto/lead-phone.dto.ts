import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';
import { toEnglishDigits } from '../../../common/utils/normalize-digits';

// docs/PRD-nivo-lead-shop-seller-signup.md §5.2 — اعتبارسنجی نهایی در LeadSignupService (normalizeLeadPhone)
export class LeadPhoneDto {
  @Transform(({ value }) => (typeof value === 'string' ? toEnglishDigits(value) : value))
  @IsString({ message: fa.validation.required })
  @MaxLength(20, { message: fa.validation.phoneInvalid })
  phone!: string;

  // docs/PRD-nivo-lead-shop-seller-signup.md §5.6 — UTM از لینک اینستاگرام؛ هر مقدار ≤۱۰۰ کاراکتر (در سرویس trim می‌شود)
  @IsOptional() @IsString() @MaxLength(100) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(100) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(100) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(100) utmContent?: string;
}
