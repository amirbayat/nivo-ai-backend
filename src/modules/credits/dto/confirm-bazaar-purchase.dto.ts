import { IsString, IsUUID, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// تایید یک خرید که از قبل سمت کلاینت (SDK پولکی کافه‌بازار) کامل شده — packageId باید به یک
// CreditPackage با bazaarSku ست‌شده اشاره کند (CreditsService.confirmBazaarPurchase چک می‌کند).
export class ConfirmBazaarPurchaseDto {
  @IsUUID(undefined, { message: fa.validation.required })
  packageId: string;

  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  purchaseToken: string;
}
