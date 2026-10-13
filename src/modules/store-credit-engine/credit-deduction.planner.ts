import type { CreditSource } from '@prisma/client';

// فاز ۱ — مشخصات ج ۲۳.۳: الگوریتم خالص (بدون DB) کسر اعتبار. جدا از سرویس نوشته شده تا با
// تست مرزی (دقیقاً برابر، یک تومان بالاتر، یک منبع، منفی، ...) قابل‌اثبات باشد.

// خطای اعشاری (مثلاً 100.00000000000001) نباید یک تومان اضافه ceil شود
const EPS = 1e-9;

export interface PlanBucket {
  source: CreditSource;
  balanceToman: number;
  markup: number;
}

export interface DeductionPlanInput {
  rawCostToman: number;
  trial: { active: boolean; remainingToman: number; markup: number };
  buckets: PlanBucket[];
  // وقتی هیچ بخشی وجود ندارد، مصرف روی این منبع (LEGACY با ضرایب پیش‌فرض) منفی می‌شود
  overflowFallback: { source: CreditSource; markup: number };
}

export interface BucketCharge {
  source: CreditSource;
  chargedToman: number;
  markup: number;
}

export interface DeductionPlan {
  trialChargedToman: number;
  trialMarkup: number;
  bucketCharges: BucketCharge[];
  chargedToman: number;
}

const ceilSafe = (n: number) => Math.ceil(n - EPS);

export function planDeduction(input: DeductionPlanInput): DeductionPlan {
  let remainingRaw = Math.max(0, input.rawCostToman);
  let trialCharged = 0;

  // ۱) اعتبار آزمایشی (ضرایب سراسری): تا حد موجودی‌اش؛ مابقی از بخش‌ها (اصلاح نشت 1.2.4)
  if (
    input.trial.active &&
    remainingRaw > 0 &&
    input.trial.remainingToman > 0
  ) {
    const full = ceilSafe(remainingRaw * input.trial.markup);
    if (full <= input.trial.remainingToman) {
      trialCharged = full;
      remainingRaw = 0;
    } else {
      trialCharged = input.trial.remainingToman;
      remainingRaw -= input.trial.remainingToman / input.trial.markup;
      if (remainingRaw < EPS) remainingRaw = 0;
    }
  }

  const charges = new Map<CreditSource, BucketCharge>();
  const addCharge = (source: CreditSource, markup: number, amount: number) => {
    const prev = charges.get(source);
    if (prev) prev.chargedToman += amount;
    else charges.set(source, { source, chargedToman: amount, markup });
  };

  // ۲) بخش‌های با موجودی مثبت، به ترتیب ضریب صعودی (ارزان‌ترین اول)
  const positives = input.buckets
    .filter((b) => b.balanceToman > 0)
    .sort((a, b) => a.markup - b.markup);
  for (const bucket of positives) {
    if (remainingRaw <= EPS) break;
    const coverableRaw = bucket.balanceToman / bucket.markup;
    if (coverableRaw >= remainingRaw - EPS) {
      // این بخش همه‌ی باقی‌مانده را می‌پوشاند
      const charge = Math.min(
        bucket.balanceToman,
        ceilSafe(remainingRaw * bucket.markup),
      );
      addCharge(bucket.source, bucket.markup, charge);
      remainingRaw = 0;
    } else {
      addCharge(bucket.source, bucket.markup, bucket.balanceToman);
      remainingRaw -= coverableRaw;
    }
  }

  // ۳) باقی‌مانده (موجودی صفر/منفی): با ضریب «ارزان‌ترین بخش» کسر و همان بخش منفی می‌شود
  if (remainingRaw > EPS) {
    const cheapest =
      [...input.buckets].sort((a, b) => a.markup - b.markup)[0] ??
      input.overflowFallback;
    addCharge(
      cheapest.source,
      cheapest.markup,
      ceilSafe(remainingRaw * cheapest.markup),
    );
  }

  const bucketCharges = [...charges.values()].filter((c) => c.chargedToman > 0);
  const chargedToman =
    trialCharged + bucketCharges.reduce((sum, c) => sum + c.chargedToman, 0);
  return {
    trialChargedToman: trialCharged,
    trialMarkup: input.trial.markup,
    bucketCharges,
    chargedToman,
  };
}

// خرید ثابت‌مبلغ (جایگاه تبلیغاتی، مشخصات ج ۲۳.۳ پایان): مبلغ از هر بخش در m_بخش ÷ ضریب سراسری
// خریدار ضرب می‌شود تا کارمزد از این مسیر دور نخورد؛ شرط «موجودی ≥ قیمت» روی مجموع «موثر»
// بخش‌هاست. اعتبار آزمایشی در این مسیر مصرف نمی‌شود و overdraft نداریم → null = ناکافی.
export function planFixedPriceDebit(input: {
  priceToman: number;
  globalMarkup: number;
  buckets: PlanBucket[];
}): BucketCharge[] | null {
  let remaining = input.priceToman;
  const charges: BucketCharge[] = [];
  const positives = input.buckets
    .filter((b) => b.balanceToman > 0)
    .sort((a, b) => a.markup - b.markup);
  for (const bucket of positives) {
    if (remaining <= EPS) break;
    const ratio = bucket.markup / input.globalMarkup;
    const effective = bucket.balanceToman / ratio;
    if (effective >= remaining - EPS) {
      const charge = Math.min(bucket.balanceToman, ceilSafe(remaining * ratio));
      charges.push({
        source: bucket.source,
        chargedToman: charge,
        markup: bucket.markup,
      });
      remaining = 0;
    } else {
      charges.push({
        source: bucket.source,
        chargedToman: bucket.balanceToman,
        markup: bucket.markup,
      });
      remaining -= effective;
    }
  }
  return remaining > EPS ? null : charges.filter((c) => c.chargedToman > 0);
}
