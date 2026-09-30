// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۱ — امتیاز تکمیل‌بودن هر محصول: سه معیار
// مساوی‌وزن (عکس/توضیح/حداقل ۲ سؤال دانش‌نامه‌ی مرتبط)، محاسبه‌شده on-the-fly نه ذخیره‌شده —
// چون هر سه ورودی (images، description، تعداد StoreKbEntry) از قبل در دیتابیس هستند
export interface ProductCompletenessInput {
  images: string[];
  description: string | null;
}

export interface ProductCompleteness {
  percent: number;
  missing: string[];
}

const MIN_RELATED_KB_ENTRIES = 2;

export function computeProductCompleteness(
  product: ProductCompletenessInput,
  relatedKbEntryCount: number,
): ProductCompleteness {
  const checks = [
    { done: product.images.length > 0, label: 'عکس' },
    { done: !!product.description?.trim(), label: 'توضیح' },
    {
      done: relatedKbEntryCount >= MIN_RELATED_KB_ENTRIES,
      label: `حداقل ${MIN_RELATED_KB_ENTRIES} سؤال مرتبط در باکس دانش`,
    },
  ];
  const doneCount = checks.filter((c) => c.done).length;
  return {
    percent: Math.round((doneCount / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.label),
  };
}
