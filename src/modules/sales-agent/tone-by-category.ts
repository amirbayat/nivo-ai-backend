// docs/PRD-sales-agent-voice.md بخش ۱.۴ — لحن تطبیقی بر اساس Store.category (که همین امروز
// از ۶ به ۱۴ گزینه گسترش یافت، seller.step1.categories در فرانت‌اند). نگاشت ثابت در کد،
// نه دیتابیس. هم در سیستم‌پرامپت caption() هم در پرامپت TTS استفاده می‌شود.
export const TONE_BY_CATEGORY: Record<string, string> = {
  پوشاک: 'شاد، پرانرژی، صمیمی',
  'کیف و کفش': 'شاد، پرانرژی، صمیمی',
  'آرایشی و بهداشتی': 'آرام، لوکس، مطمئن',
  'جواهرات و اکسسوری': 'آرام، لوکس، مطمئن',
  'دیجیتال و لوازم جانبی': 'حرفه‌ای، دقیق، بدون شلوغی',
  'خوراکی و صنایع غذایی': 'گرم، دوستانه، خانگی',
  'کودک و نوزاد': 'مهربان، آرام‌بخش',
  // docs/PRD-business-types-and-appointment-booking.md بخش ۶ — ۴ حوزه‌ی خدماتی جدید
  // (businessType=APPOINTMENT_BOOKING در اکثر موارد)، لحن حرفه‌ای/آرام به‌جای لحن شاد فروش کالا
  'پزشکی و دندان‌پزشکی': 'حرفه‌ای، آرام، مطمئن',
  مشاوره: 'حرفه‌ای، آرام، مطمئن',
  'سالن زیبایی و آرایشگاه': 'حرفه‌ای، آرام، مطمئن',
  'آموزش خصوصی و مربی‌گری': 'حرفه‌ای، آرام، مطمئن',
};

export const DEFAULT_TONE = 'معمولی، خنثی، محاوره‌ای دوستانه';

export function toneForCategory(category: string | null | undefined): string {
  if (!category) return DEFAULT_TONE;
  return TONE_BY_CATEGORY[category] ?? DEFAULT_TONE;
}
