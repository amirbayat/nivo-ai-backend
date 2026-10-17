// ACE-9 — نرمال‌سازی متن فارسی برای امضا. خالص و بدون I/O.
const AR_TO_FA: Record<string, string> = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'ؤ': 'و' };

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (ch) => {
    const c = ch.charCodeAt(0);
    return String(c >= 0x06f0 && c <= 0x06f9 ? c - 0x06f0 : c - 0x0660);
  });
}

export function normalizeFa(input: string): string {
  let s = String(input ?? '');
  s = s.replace(/[يىكۀةأإؤ]/g, (c) => AR_TO_FA[c] ?? c);
  s = s.replace(/[ً-ٰٟـ]/g, ''); // اعراب و کشیده
  s = s.replace(/[‌‍‎‏]/g, ' '); // ZWNJ و نشانه‌های جهت → فاصله
  s = toLatinDigits(s);
  s = s.replace(/[٬,،]/g, ''); // جداکننده‌ی هزارگان
  s = s.replace(/\p{Extended_Pictographic}|️/gu, ' '); // ایموجی
  s = s.replace(/[؟?]+/g, ' ? ').replace(/[!！]+/g, ' ').replace(/[.…]+/g, ' ').replace(/[،;:؛"“”«»()\[\]]/g, ' ');
  s = s.replace(/([a-zA-Z])\1{2,}/g, '$1$1').replace(/(\p{L})\1{2,}/gu, '$1$1'); // کشیده‌نویسی «سلااام»
  s = s.toLowerCase();
  return s.replace(/\s+/g, ' ').trim();
}
