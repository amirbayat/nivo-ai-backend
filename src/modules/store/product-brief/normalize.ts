import { toEnglishDigits } from '../../../common/utils/normalize-digits';

// متنی که offsetهای بخش‌ها روی آن حساب می‌شود (ذخیره نمی‌شود؛ هر مصرف‌کننده باید همین را از description بسازد)
export function normalizeDescription(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\r\n?/g, '\n').trim();
}

// برای مقایسه‌ی «پیدا شدن در متن»: ارقام → لاتین، ي/ك → ی/ک، حذف نیم‌فاصله و جداکننده‌ی هزارگان، فاصله‌ی اضافه
export function normForMatch(s: string): string {
  return toEnglishDigits(s)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[آأإ]/g, 'ا')
    .replace(/[‌‏‎]/g, '')
    .replace(/(?<=\d)[,٬،](?=\d)/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
