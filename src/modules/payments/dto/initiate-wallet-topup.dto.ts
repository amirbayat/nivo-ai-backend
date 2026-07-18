import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Min } from 'class-validator'
import { PaymentProvider } from '@prisma/client'
import { fa } from '../../../i18n/fa'
import { PAYMENT_GATEWAY_NAMES } from '../gateways/payment-gateway.interface'

// docs/PRD-pay-as-you-go-wallet.md بخش ۵.۱ — حداقل واقعی (فعال‌سازی ۱M در برابر شارژ بعدی ۵۰۰k)
// در سرویس چک می‌شود چون به وضعیت کاربر (اولین شارژ یا نه) بستگی دارد، نه یک عدد ثابت این‌جا
export class InitiateWalletTopupDto {
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  amountToman: number

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(PAYMENT_GATEWAY_NAMES, { message: fa.payment.gatewayNotEnabled })
  gateway?: PaymentProvider

  // docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴/۵.۵ — همان معنی initiate-payment.dto.ts
  @IsOptional()
  @IsIn(['app'], { message: fa.validation.required })
  source?: 'app'
}
