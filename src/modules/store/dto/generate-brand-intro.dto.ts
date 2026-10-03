import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (پروفایل برند عمیق‌تر در آنبوردینگ)
export class GenerateBrandIntroDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.brandIntroTextRequired })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  rawText: string;
}
