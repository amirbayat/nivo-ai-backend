import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// پاسخ موفق https://developers.cafebazaar.ir/fa/document/in-app-billing/api/validation/
interface BazaarValidateResponse {
  consumptionState: number;
  purchaseState: number; // 0 = خرید عادی، 1 = ریفاند شده
  kind: string;
  developerPayload?: string;
  purchaseTime: number;
}

interface BazaarValidateError {
  error: string; // اگر برابر "not_found" باشد یعنی این خرید اصلاً انجام نشده (احتمال جعل)
  error_description: string;
}

// 0.13d — فقط کاراکترهای امن و بدون `..`؛ هر چیز دیگر قبل از ساخت URL رد می‌شود
export const BAZAAR_SAFE_TOKEN = /^(?!.*\.\.)[A-Za-z0-9._-]+$/;

@Injectable()
export class BazaarIabService {
  private readonly logger = new Logger(BazaarIabService.name);
  private readonly baseUrl = 'https://pardakht.cafebazaar.ir/devapi/v2/api';
  private readonly packageName: string;
  private readonly apiSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.packageName =
      this.config.get<string>('CAFEBAZAAR_PACKAGE_NAME') ?? 'ir.nivo.cal';
    this.apiSecret = this.config.get<string>('CAFEBAZAAR_PISHKHAN_API_SECRET');
  }

  // اعتبارسنجی سمت سرور یک purchaseToken که کلاینت (پولکی) بعد از خرید برگردانده — هرگز به گزارش
  // موفقیت خود کلاینت اعتماد نمی‌کنیم، چون purchaseToken جعلی/تکراری از کلاینت قابل ساخت است.
  async validatePurchase(
    productId: string,
    purchaseToken: string,
  ): Promise<{ valid: boolean }> {
    if (!this.apiSecret) {
      this.logger.error(
        'CAFEBAZAAR_PISHKHAN_API_SECRET تنظیم نشده — اعتبارسنجی خرید بازار ممکن نیست',
      );
      return { valid: false };
    }

    if (
      !BAZAAR_SAFE_TOKEN.test(purchaseToken) ||
      !BAZAAR_SAFE_TOKEN.test(productId)
    ) {
      this.logger.warn(
        `validatePurchase: rejected unsafe productId/purchaseToken (len=${purchaseToken.length})`,
      );
      return { valid: false };
    }

    const url = `${this.baseUrl}/validate/${encodeURIComponent(this.packageName)}/inapp/${encodeURIComponent(productId)}/purchases/${encodeURIComponent(purchaseToken)}/`;
    const res = await fetch(url, {
      headers: { 'CAFEBAZAAR-PISHKHAN-API-SECRET': this.apiSecret },
    });

    if (!res.ok) {
      const errBody = (await res
        .json()
        .catch(() => null)) as BazaarValidateError | null;
      this.logger.warn(
        `validatePurchase: status=${res.status} error=${errBody?.error} desc=${errBody?.error_description}`,
      );
      return { valid: false };
    }

    const json = (await res.json()) as BazaarValidateResponse;
    this.logger.log(
      `validatePurchase: productId=${productId} purchaseState=${json.purchaseState} consumptionState=${json.consumptionState}`,
    );
    return { valid: json.purchaseState === 0 };
  }
}
