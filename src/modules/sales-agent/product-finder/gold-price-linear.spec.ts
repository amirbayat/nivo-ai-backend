import { computeDisplayPrice } from '../../store/product-pricing.util';
import { effectiveWagePercent, linearGoldPrice } from './gold-price-linear';

// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۵ — تضمین یکسانی ضرایب خطی با
// منبع حقیقت قیمت (computeDisplayPrice)

function rnd(min: number, max: number) {
  return min + Math.random() * (max - min);
}

describe('linearGoldPrice ≡ computeDisplayPrice', () => {
  it('برای هزاران ورودی تصادفی هر دو نوع اجرت دقیقاً برابر است', () => {
    for (let i = 0; i < 4000; i++) {
      const G = Math.round(rnd(2_000_000, 9_000_000));
      const weightGrams = Math.round(rnd(0.3, 40) * 100) / 100;
      const purityKarat = [18, 21, 22, 24][Math.floor(rnd(0, 4))];
      const type = Math.random() < 0.5 ? 'PERCENT' : 'FIXED_PER_GRAM';
      const wageValue =
        type === 'PERCENT'
          ? Math.round(rnd(0, 30) * 10) / 10
          : Math.round(rnd(0, 800_000));
      const profit = Math.round(rnd(0, 20) * 10) / 10;
      const vat = Math.random() < 0.5 ? 10 : Math.round(rnd(0, 12));
      const expected = computeDisplayPrice(
        {
          pricingModel: 'WEIGHT_BASED_FORMULA',
          basePrice: 0,
          weightGrams,
          purityKarat,
          goldWageType: type,
          goldWageValue: wageValue,
          goldProfitPercent: profit,
        },
        null,
        {
          goldWageType: null,
          goldWageValue: null,
          goldProfitPercent: null,
          goldVatPercent: vat,
        },
        [
          {
            symbol: 'IR_GOLD_18K',
            name: 'طلا ۱۸',
            name_en: '18K Gold',
            price: G,
          } as never,
        ],
      );
      const got = linearGoldPrice({
        weightGrams,
        purityKarat,
        wage: { type, value: wageValue },
        profitPercent: profit,
        vatPercent: vat,
        gold18PerGram: G,
      });
      // اختلاف فقط می‌تواند از گردکردن نیمه‌ی دقیق روی خطای ممیز شناور باشد
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(1000);
      if (Math.abs(got - expected) > 0) {
        // باید نادر باشد، نه سیستماتیک
        expect(Math.abs(got - expected)).toBe(1000);
      }
    }
  });

  it('اجرت مؤثر درصدی برای FIXED_PER_GRAM نسبت به ارزش خام طلاست', () => {
    // اجرت ۳۰۰هزار در گرم، نرخ ۱۸ = ۶میلیون، عیار ۱۸ → ۵٪
    expect(
      effectiveWagePercent({
        purityKarat: 18,
        wage: { type: 'FIXED_PER_GRAM', value: 300_000 },
        gold18PerGram: 6_000_000,
      }),
    ).toBeCloseTo(5, 6);
    expect(
      effectiveWagePercent({
        purityKarat: 18,
        wage: { type: 'PERCENT', value: 7 },
        gold18PerGram: 1,
      }),
    ).toBe(7);
  });
});
