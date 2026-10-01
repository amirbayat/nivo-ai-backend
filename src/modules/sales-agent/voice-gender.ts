// docs/PRD-sales-agent-voice.md بخش ۶.۴ — نه تلگرام نه وب فیلد جنسیت واقعی می‌دهند؛ تنها سیگنال
// در دسترس اسم اول پروفایل تلگرام است. این یک تخمین ساده و شفاف است (نه ادعای دقت بالا، طبق
// متن سند) — فقط یک لیست کوچک از رایج‌ترین اسم‌های فارسی، پیش‌فرض روی «نامشخص» (صدای خنثی)
// وقتی اسم در لیست نیست یا اصلاً در دسترس نبود.
const COMMON_MALE_FIRST_NAMES = new Set([
  'علی',
  'محمد',
  'حسین',
  'رضا',
  'حسن',
  'مهدی',
  'امیر',
  'احمد',
  'جواد',
  'مجتبی',
  'سجاد',
  'امیرحسین',
  'محمدرضا',
  'علیرضا',
  'بهنام',
  'آرش',
  'کیان',
  'سینا',
  'پویا',
  'فرهاد',
  'بابک',
  'کامران',
  'سعید',
  'وحید',
  'مسعود',
  'یاسین',
  'میلاد',
  'پیمان',
  'شاهین',
  'داوود',
]);

const COMMON_FEMALE_FIRST_NAMES = new Set([
  'فاطمه',
  'زهرا',
  'مریم',
  'سارا',
  'نرگس',
  'نگار',
  'الهام',
  'شیوا',
  'شیدا',
  'مهسا',
  'نیلوفر',
  'پریسا',
  'یگانه',
  'ریحانه',
  'سمیرا',
  'آیدا',
  'بهاره',
  'پگاه',
  'ترانه',
  'رویا',
  'سپیده',
  'فرناز',
  'لیلا',
  'مینا',
  'نازنین',
  'هانیه',
  'آناهیتا',
  'طاهره',
  'فریبا',
  'گلناز',
]);

export type InferredGender = 'MALE' | 'FEMALE' | 'UNKNOWN';

// فقط اولین کلمه (اسم کوچک) چک می‌شود — fullName ممکن است نام خانوادگی هم داشته باشد
export function inferGenderFromFirstName(
  fullName: string | null | undefined,
): InferredGender {
  const firstToken = fullName?.trim().split(/\s+/)[0];
  if (!firstToken) return 'UNKNOWN';
  if (COMMON_MALE_FIRST_NAMES.has(firstToken)) return 'MALE';
  if (COMMON_FEMALE_FIRST_NAMES.has(firstToken)) return 'FEMALE';
  return 'UNKNOWN';
}

// صدای پیش‌فرض/خنثی — همان Kore که با تست دستی تایید شده (زنانه). صدای مردانه (Puck) پیشنهاد
// خودِ سند است از فهرست عمومی Gemini TTS؛ طبق سند هنوز با گوش تایید نشده — قبل از فعال‌سازی
// واقعی روی ترافیک، باید یک‌بار دستی شنیده و تایید شود.
export const NEUTRAL_VOICE = 'Kore';
const FEMALE_VOICE = 'Kore';
const MALE_VOICE = 'Puck';

// بخش ۶.۴ عنوانش «صدای مخالفِ جنسیتِ مخاطب» است — یعنی عمداً صدای مخالف جنسیت تخمینی خریدار
export function voiceForBuyer(fullName: string | null | undefined): string {
  const gender = inferGenderFromFirstName(fullName);
  if (gender === 'MALE') return FEMALE_VOICE;
  if (gender === 'FEMALE') return MALE_VOICE;
  return NEUTRAL_VOICE;
}
