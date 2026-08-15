import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator'
import { PaymentProvider } from '@prisma/client'
import { fa } from '../../../i18n/fa'
import { PAYMENT_GATEWAY_NAMES } from '../../payments/gateways/payment-gateway.interface'

// خرید یک بسته‌ی نیوو — یا از پیش‌تعریف‌شده، یا (اگر packageId به یک بسته‌ی isCustomAmount اشاره
// کند) مبلغ دلخواه با customCredits. دقیقاً همان مسیر initiateWalletTopup پلن PAYG، فقط
// amountToman از روی CreditPackage/customCredits محاسبه می‌شود، نه ورودی آزاد بی‌قاعده.
export class PurchaseCreditPackageDto {
  @IsUUID(undefined, { message: fa.validation.required })
  packageId: string

  // فقط برای بسته‌ی isCustomAmount=true — باید >= credits (حداقل تعریف‌شده در همان بسته) باشد
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  customCredits?: number

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(PAYMENT_GATEWAY_NAMES, { message: fa.payment.gatewayNotEnabled })
  gateway?: PaymentProvider
}
