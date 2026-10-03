// docs/PRD-seller-knowledge-base.md بخش ۹.۲ (سوم) — همون الگوی product-video.types.ts؛
// type (نه interface) چون interface با Prisma.InputJsonValue/InputJsonObject موقع nest‌شدن
// داخل یک شیء بزرگ‌تر (مثلاً UiBlock ذخیره‌شده با Prisma.InputJsonObject) خطای تایپ می‌داد.
export type ProductSpecItem = {
  label: string;
  value: string;
};

export function parseProductSpecs(value: unknown): ProductSpecItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ProductSpecItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ProductSpecItem).label === 'string' &&
      typeof (item as ProductSpecItem).value === 'string',
  );
}

// همون سقف‌هایی که store-kb.service.ts موقع تولید با AI اعمال می‌کرد (قبلاً clampSpecs محلی
// همون فایل) — اینجا مشترک شد چون فروشنده حالا می‌تواند specs را مستقیم از صفحه‌ی ویرایش
// محصول هم بفرستد (UpdateProductDto)، نه فقط از مسیر AI
const MAX_SPECS = 8;
const MAX_LABEL_CHARS = 40;
const MAX_VALUE_CHARS = 120;

export function clampProductSpecs(
  specs: ProductSpecItem[] | undefined,
): ProductSpecItem[] | undefined {
  const clamped = specs
    ?.map((s) => ({
      label: s.label.trim().slice(0, MAX_LABEL_CHARS),
      value: s.value.trim().slice(0, MAX_VALUE_CHARS),
    }))
    .filter((s) => s.label && s.value)
    .slice(0, MAX_SPECS);
  return clamped?.length ? clamped : undefined;
}

export function formatSpecsForFacts(specs: ProductSpecItem[]): string {
  if (!specs.length) return '';
  return ` — مشخصات: ${specs.map((s) => `${s.label}: ${s.value}`).join('، ')}`;
}
