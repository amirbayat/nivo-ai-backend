// docs/PRD-sales-agent-voice.md بخش ۱.۴ — لحن تطبیقی بر اساس Store.category (که همین امروز
// از ۶ به ۱۴ گزینه گسترش یافت، seller.step1.categories در فرانت‌اند). نگاشت ثابت در کد،
// نه دیتابیس — فقط ۱۴ مقدار ثابت است. هم در سیستم‌پرامپت caption() هم در پرامپت TTS استفاده
// می‌شود.
export const TONE_BY_CATEGORY: Record<string, string> = {
  پوشاک: 'شاد، پرانرژی، صمیمی',
  'کیف و کفش': 'شاد، پرانرژی، صمیمی',
  'آرایشی و بهداشتی': 'آرام، لوکس، مطمئن',
  'جواهرات و اکسسوری': 'آرام، لوکس، مطمئن',
  'دیجیتال و لوازم جانبی': 'حرفه‌ای، دقیق، بدون شلوغی',
  'خوراکی و صنایع غذایی': 'گرم، دوستانه، خانگی',
  'کودک و نوزاد': 'مهربان، آرام‌بخش',
};

export const DEFAULT_TONE = 'معمولی، خنثی، محاوره‌ای دوستانه';

export function toneForCategory(category: string | null | undefined): string {
  if (!category) return DEFAULT_TONE;
  return TONE_BY_CATEGORY[category] ?? DEFAULT_TONE;
}
