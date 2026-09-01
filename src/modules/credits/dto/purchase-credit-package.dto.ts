import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PaymentProvider } from '@prisma/client';
import { fa } from '../../../i18n/fa';
import { PAYMENT_GATEWAY_NAMES } from '../../payments/gateways/payment-gateway.interface';

// خرید یک بسته‌ی نیوو — یا از پیش‌تعریف‌شده، یا (اگر packageId به یک بسته‌ی isCustomAmount اشاره
// کند) مبلغ دلخواه با customCredits. مستقل از Plan/isPayAsYouGo — amountToman از روی
// CreditPackage/customCredits محاسبه می‌شود (PaymentsService.initiateCreditTopup).
export class PurchaseCreditPackageDto {
  @IsUUID(undefined, { message: fa.validation.required })
  packageId: string;

  // فقط برای بسته‌ی isCustomAmount=true — باید >= credits (حداقل تعریف‌شده در همان بسته) باشد
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  customCredits?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(PAYMENT_GATEWAY_NAMES, { message: fa.payment.gatewayNotEnabled })
  gateway?: PaymentProvider;

  // برای اپ/فرانتی که روی دامنه‌ی جدا از نیوو اصلی اجرا می‌شود (مثل نیوو کال) — origin ای که
  // کاربر باید بعد از پرداخت به آن برگردد، به‌جای APP_URL سراسری. فقط اگر در whitelist
  // ثابت PaymentsService (ALLOWED_RETURN_ORIGINS) باشد اعمال می‌شود؛ در غیر این صورت نادیده
  // گرفته می‌شود و رفتار فعلی (برگشت به APP_URL) بدون تغییر باقی می‌ماند — جلوگیری از open-redirect.
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
