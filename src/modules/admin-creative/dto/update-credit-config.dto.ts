import { Type } from 'class-transformer'
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator'
import { fa } from '../../../i18n/fa'

// نرخ تبدیل + ضریب فروش + شارژ اولیه‌ی رایگان — همه از ادمین قابل‌تغییر (بخش ۵.۷/۳.۱)
export class UpdateCreditConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  tomanPerCredit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  purchaseMarkup?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  freeSignupCredits?: number
}
