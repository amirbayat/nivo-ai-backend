import { GoldWageType, PricingModel } from '@prisma/client';
import { GoldPriceItem } from '../market-prices/market-prices.service';
import { toEnglishDigits } from '../../common/utils/normalize-digits';

// docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲ — محصولات
// pricingModel=FIXED (اکثریت امروز) از این فایل اصلاً عبور نمی‌کنند؛ تنها مصرف‌کننده‌ی
// واقعی WEIGHT_BASED_FORMULA است (فعلاً فقط طلا). basePrice/priceOverride برای این مدل
// نادیده گرفته می‌شود — قیمت همیشه at-request-time از نرخ لحظه‌ای محاسبه می‌شود، هرگز در DB
// ذخیره نمی‌شود، چون کل هدف «قیمت همیشه به‌روز» است.

export interface GoldPricingInputs {
  pricingModel: PricingModel;
  basePrice: number;
  weightGrams: number | null;
  purityKarat: number | null;
}

export interface StoreGoldPricingSettings {
  goldWageType: GoldWageType | null;
  goldWageValue: number | null;
  goldProfitPercent: number | null;
  goldVatPercent: number;
}

const ROUND_TO_TOMAN = 1000;

// docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۱ — پاسخ BrsApi فرمت
// دقیق symbol را برای طلای ۱۸ عیار مستند نمی‌کند (فقط در تست اولیه‌ی API دیده شده، نه در کد)؛
// این تابع با چند الگوی محتمل (symbol، نام فارسی «۱۸ عیار»، نام انگلیسی "18") تطبیق می‌دهد تا
// اگر فرمت دقیق symbol فرق داشت هم کار کند. اولین باری که BRSAPI_API_KEY واقعی ست شد، باید
// پاسخ واقعی لاگ و این تطبیق verify شود.
export function find18kGoldItem(items: GoldPriceItem[]): GoldPriceItem | null {
  const bySymbol = items.find((i) => /^IR_?GOLD_?18/i.test(i.symbol));
  if (bySymbol) return bySymbol;

  const byNameEn = items.find(
    (i) => /18\s*k/i.test(i.name_en) && /gold/i.test(i.name_en),
  );
  if (byNameEn) return byNameEn;

  const byNameFa = items.find((i) => {
    const normalized = toEnglishDigits(i.name);
    return normalized.includes('18') && i.name.includes('طلا');
  });
  return byNameFa ?? null;
}

export class GoldPriceUnavailableError extends Error {
  constructor() {
    super('نرخ لحظه‌ای طلای ۱۸ عیار در دسترس نیست');
    this.name = 'GoldPriceUnavailableError';
  }
}

export class GoldPricingNotConfiguredError extends Error {
  constructor() {
    super('تنظیمات اجرت/سود طلای فروشگاه هنوز مشخص نشده');
    this.name = 'GoldPricingNotConfiguredError';
  }
}

/**
 * قیمت نمایشی یک محصول (یا یک واریانت خاص آن) را محاسبه می‌کند. برای pricingModel=FIXED
 * همان basePrice/priceOverride فعلی برمی‌گردد — رفتار امروز دست‌نخورده می‌ماند.
 */
export function computeDisplayPrice(
  product: GoldPricingInputs,
  variantOverride: {
    priceOverride: number | null;
    weightGrams: number | null;
    purityKarat: number | null;
  } | null,
  store: StoreGoldPricingSettings,
  goldItems: GoldPriceItem[],
): number {
  if (product.pricingModel !== 'WEIGHT_BASED_FORMULA') {
    return variantOverride?.priceOverride ?? product.basePrice;
  }

  const weightGrams = variantOverride?.weightGrams ?? product.weightGrams;
  const purityKarat = variantOverride?.purityKarat ?? product.purityKarat;
  if (!weightGrams || !purityKarat) {
    // داده‌ی ناقص — نباید رخ دهد اگر فرم فروشنده درست اعتبارسنجی شده باشد، ولی برای ایمنی
    // به basePrice برمی‌گردیم تا یک خطای کرش‌کننده در مسیر نمایش محصول نشود
    return product.basePrice;
  }

  if (
    !store.goldWageType ||
    store.goldWageValue == null ||
    store.goldProfitPercent == null
  ) {
    throw new GoldPricingNotConfiguredError();
  }

  const gold18k = find18kGoldItem(goldItems);
  if (!gold18k) throw new GoldPriceUnavailableError();

  // بخش ۲.۱ سند — مبنا همیشه نرخ ۱۸ عیار است؛ نرخ عیارهای دیگر با نسبت ساده مشتق می‌شود
  const pricePerGram = gold18k.price * (purityKarat / 18);
  const basePriceCalc = weightGrams * pricePerGram;
  const wage =
    store.goldWageType === 'PERCENT'
      ? basePriceCalc * (store.goldWageValue / 100)
      : store.goldWageValue * weightGrams;
  const profit = (basePriceCalc + wage) * (store.goldProfitPercent / 100);
  const vat = (wage + profit) * (store.goldVatPercent / 100);
  const finalPrice = basePriceCalc + wage + profit + vat;

  return Math.round(finalPrice / ROUND_TO_TOMAN) * ROUND_TO_TOMAN;
}
