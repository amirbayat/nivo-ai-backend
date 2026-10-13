import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// تایید یک خرید که از قبل سمت کلاینت (SDK پولکی کافه‌بازار) کامل شده — packageId باید به یک
// CreditPackage با bazaarSku ست‌شده اشاره کند (CreditsService.confirmBazaarPurchase چک می‌کند).
export class ConfirmBazaarPurchaseDto {
  @IsUUID(undefined, { message: fa.validation.required })
  packageId: string;

  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(512, { message: fa.payment.bazaarInvalidPurchase })
  // 0.13d — توکن در path URL بازار می‌نشیند؛ `/` یا `..` اجازه‌ی path-traversal به خرید
  // ارزان‌تر می‌داد (هر واریانت یک providerRef تازه = نقد شدن بی‌نهایت)
  @Matches(/^(?!.*\.\.)[A-Za-z0-9._-]+$/, {
    message: fa.payment.bazaarInvalidPurchase,
  })
  purchaseToken: string;
}
