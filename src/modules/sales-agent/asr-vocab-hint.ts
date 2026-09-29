// فیدبک کاربر ۱۴۰۵/۰۷/۰۸: ASR روی وویس مشتری‌ها غلط املایی زیاد داشت. AsrService.prompt
// (فیلد استاندارد Whisper، فقط بایاس سبک/واژگان، نه دستور) با اسم فروشگاه/محصولات واقعی
// پر می‌شود تا حداقل املای اسم‌های خاصِ همان فروشگاه را درست‌تر تشخیص بدهد
export function buildAsrVocabHint(
  storeName: string,
  productNames: string[],
): string {
  const names = productNames.slice(0, 8).join('، ');
  const productsPart = names ? ` محصولات: ${names}.` : '';
  return `مکالمه‌ی خریدوفروش با فروشگاه ${storeName}.${productsPart} مثل: «قیمتش چنده؟»، «موجود دارید؟»، «آدرس رو بفرستید».`;
}
