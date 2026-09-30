import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaymentProvider } from '@prisma/client';
import { fa } from '../../../i18n/fa';
import { PAYMENT_GATEWAY_NAMES } from '../../payments/gateways/payment-gateway.interface';

// docs/PRD-seller-credit-billing.md بخش ۷ — خرید یک بسته‌ی اعتبار AI فروشگاه (scope=STORE_AI_CREDIT)
export class PurchaseStoreCreditDto {
  @IsUUID(undefined, { message: fa.validation.required })
  packageId: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(PAYMENT_GATEWAY_NAMES, { message: fa.payment.gatewayNotEnabled })
  gateway?: PaymentProvider;
}
