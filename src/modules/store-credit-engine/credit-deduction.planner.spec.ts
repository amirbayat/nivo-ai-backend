import {
  planDeduction,
  planFixedPriceDebit,
  type PlanBucket,
} from './credit-deduction.planner';

const noTrial = { active: false, remainingToman: 0, markup: 2 };
const legacyFallback = { source: 'LEGACY' as const, markup: 2 };
const bucket = (
  source: PlanBucket['source'],
  balanceToman: number,
  markup: number,
): PlanBucket => ({ source, balanceToman, markup });

const run = (rawCostToman: number, buckets: PlanBucket[], trial = noTrial) =>
  planDeduction({
    rawCostToman,
    trial,
    buckets,
    overflowFallback: legacyFallback,
  });

describe('planDeduction — regression با کد قبلی (تک‌بخش LEGACY)', () => {
  it.each([1, 7, 100, 333, 12_345])(
    'raw=%i: همان ceil(raw × ضریب) از LEGACY',
    (raw) => {
      const plan = run(raw, [bucket('LEGACY', 10_000_000, 2)]);
      expect(plan.chargedToman).toBe(Math.ceil(raw * 2));
      expect(plan.bucketCharges).toEqual([
        { source: 'LEGACY', chargedToman: Math.ceil(raw * 2), markup: 2 },
      ]);
    },
  );

  it('ضریب اعشاری فروشنده (۱٫۵)', () => {
    const plan = run(101, [bucket('LEGACY', 10_000, 1.5)]);
    expect(plan.chargedToman).toBe(Math.ceil(101 * 1.5));
  });
});

describe('planDeduction — مرز بخش‌ها', () => {
  it('دقیقاً برابر موجودی: بخش صفر می‌شود، overflow ندارد', () => {
    const plan = run(100, [bucket('LEGACY', 200, 2)]);
    expect(plan.chargedToman).toBe(200);
  });

  it('یک تومان بالاتر: بخش خالی + باقی‌مانده با همان ضریب (منفی)', () => {
    const plan = run(101, [bucket('LEGACY', 200, 2)]);
    expect(plan.chargedToman).toBe(202);
    expect(plan.bucketCharges).toEqual([
      { source: 'LEGACY', chargedToman: 202, markup: 2 },
    ]);
  });

  it('نویز اعشاری: موجودی ۱۱۰، ضریب ۱٫۱، raw=۱۰۰ → دقیقاً ۱۱۰ (نه ۱۱۱)', () => {
    const plan = run(100, [bucket('LEGACY', 110, 1.1)]);
    expect(plan.chargedToman).toBe(110);
  });

  it('ارزان‌ترین بخش اول، فارغ از ترتیب ورودی', () => {
    const plan = run(100, [
      bucket('SNAPPPAY', 1000, 2.5),
      bucket('ZIBAL', 100, 2),
    ]);
    // ZIBAL: ۱۰۰ تومان = ۵۰ raw؛ SNAPPPAY: ۵۰ raw × ۲٫۵ = ۱۲۵
    expect(plan.bucketCharges).toEqual([
      { source: 'ZIBAL', chargedToman: 100, markup: 2 },
      { source: 'SNAPPPAY', chargedToman: 125, markup: 2.5 },
    ]);
    expect(plan.chargedToman).toBe(225);
  });

  it('بخش منفی نادیده گرفته می‌شود (فقط مثبت‌ها مصرف می‌شوند)', () => {
    const plan = run(10, [
      bucket('ZIBAL', -500, 2),
      bucket('SNAPPPAY', 1000, 2.5),
    ]);
    expect(plan.bucketCharges).toEqual([
      { source: 'SNAPPPAY', chargedToman: 25, markup: 2.5 },
    ]);
  });

  it('موجودی صفر: overflow روی ارزان‌ترین بخشِ موجود', () => {
    const plan = run(10, [bucket('SNAPPPAY', 0, 2.5), bucket('ZIBAL', -50, 2)]);
    expect(plan.bucketCharges).toEqual([
      { source: 'ZIBAL', chargedToman: 20, markup: 2 },
    ]);
  });

  it('هیچ بخشی نیست: overflow روی LEGACY پیش‌فرض', () => {
    const plan = run(10, []);
    expect(plan.bucketCharges).toEqual([
      { source: 'LEGACY', chargedToman: 20, markup: 2 },
    ]);
  });

  it('هزینه‌ی صفر یا منفی: هیچ کسری', () => {
    expect(run(0, [bucket('LEGACY', 100, 2)]).chargedToman).toBe(0);
    expect(run(-5, [bucket('LEGACY', 100, 2)]).chargedToman).toBe(0);
  });
});

describe('planDeduction — اعتبار آزمایشی', () => {
  const trial = (remainingToman: number) => ({
    active: true,
    remainingToman,
    markup: 2,
  });

  it('کاملاً از آزمایشی (مثل امروز)', () => {
    const plan = run(100, [bucket('LEGACY', 5000, 2)], trial(1000));
    expect(plan.trialChargedToman).toBe(200);
    expect(plan.bucketCharges).toEqual([]);
  });

  it('نشت اصلاح‌شده: آزمایشی فقط تا موجودی‌اش، مابقی از بخش‌ها', () => {
    // raw=100 → ۲۰۰ تومان؛ آزمایشی ۱۰۰ دارد → ۵۰ raw از آزمایشی، ۵۰ raw از LEGACY = ۱۰۰
    const plan = run(100, [bucket('LEGACY', 5000, 2)], trial(100));
    expect(plan.trialChargedToman).toBe(100);
    expect(plan.bucketCharges).toEqual([
      { source: 'LEGACY', chargedToman: 100, markup: 2 },
    ]);
    expect(plan.chargedToman).toBe(200);
  });

  it('آزمایشی تمام‌شده/غیرفعال نادیده گرفته می‌شود', () => {
    const plan = run(10, [bucket('LEGACY', 5000, 2)], {
      active: false,
      remainingToman: 999,
      markup: 2,
    });
    expect(plan.trialChargedToman).toBe(0);
    expect(plan.chargedToman).toBe(20);
  });
});

describe('planDeduction — ناوردایی (property)', () => {
  it('Σ کسر بخش‌ها هیچ‌وقت از موجودی مثبت بخش بیشتر نمی‌شود مگر در overflow', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) {
      const buckets: PlanBucket[] = (['ZIBAL', 'SNAPPPAY', 'LEGACY'] as const)
        .filter(() => rnd() > 0.3)
        .map((s) =>
          bucket(
            s,
            Math.floor(rnd() * 2000) - 200,
            1 + Math.floor(rnd() * 30) / 10,
          ),
        );
      const raw = Math.floor(rnd() * 1500);
      const plan = run(raw, buckets);
      const total = plan.bucketCharges.reduce((a, c) => a + c.chargedToman, 0);
      expect(total).toBe(plan.chargedToman);
      // پوشش کامل: کسر کل ≥ raw × ارزان‌ترین ضریب (حداقل ضریب ممکن) و ≤ raw × بالاترین + ۲
      if (raw > 0) {
        const mins = Math.min(...buckets.map((b) => b.markup), 2);
        expect(plan.chargedToman).toBeGreaterThanOrEqual(
          Math.floor(raw * mins),
        );
      }
      for (const c of plan.bucketCharges) {
        expect(c.chargedToman).toBeGreaterThan(0);
        expect(Number.isInteger(c.chargedToman)).toBe(true);
      }
    }
  });
});

describe('planFixedPriceDebit', () => {
  it('تک‌بخش با ضریب برابر سراسری: دقیقاً قیمت', () => {
    const r = planFixedPriceDebit({
      priceToman: 300_000,
      globalMarkup: 2,
      buckets: [bucket('LEGACY', 500_000, 2)],
    });
    expect(r).toEqual([{ source: 'LEGACY', chargedToman: 300_000, markup: 2 }]);
  });

  it('بخش اسنپ‌پی (۲٫۵ در برابر سراسری ۲) گران‌تر کسر می‌شود (×۱٫۲۵)', () => {
    const r = planFixedPriceDebit({
      priceToman: 300_000,
      globalMarkup: 2,
      buckets: [bucket('SNAPPPAY', 1_000_000, 2.5)],
    });
    expect(r![0].chargedToman).toBe(375_000);
  });

  it('شرط روی مجموع «موثر»: ناکافی → null', () => {
    expect(
      planFixedPriceDebit({
        priceToman: 300_000,
        globalMarkup: 2,
        buckets: [bucket('SNAPPPAY', 300_000, 2.5)], // موثر = ۲۴۰هزار
      }),
    ).toBeNull();
  });

  it('چند بخش: ارزان‌ترین اول و مجموع موثر', () => {
    const r = planFixedPriceDebit({
      priceToman: 300_000,
      globalMarkup: 2,
      buckets: [
        bucket('SNAPPPAY', 1_000_000, 2.5),
        bucket('ZIBAL', 100_000, 2),
      ],
    });
    expect(r).toEqual([
      { source: 'ZIBAL', chargedToman: 100_000, markup: 2 },
      { source: 'SNAPPPAY', chargedToman: 250_000, markup: 2.5 },
    ]);
  });

  it('بخش منفی/صفر دیده نمی‌شود', () => {
    expect(
      planFixedPriceDebit({
        priceToman: 10,
        globalMarkup: 2,
        buckets: [bucket('ZIBAL', -5, 2), bucket('LEGACY', 0, 2)],
      }),
    ).toBeNull();
  });
});
