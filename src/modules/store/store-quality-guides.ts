import { BUSINESS_CATEGORIES } from './business-categories';

// SQ-1 (docs/PRD-demo-buyer-simulation-and-journey-2026-10-16.md) — راهنمای «پروفایل خوب فروشگاه» برای هر دسته.
// target فیلد مقصد است: متنی (brandIntro/returnPolicy/shippingInfo) با «جواب بده»، ساخت‌یافته با «تنظیم ←».
export type StoreQualityTarget =
  | 'brandIntro' | 'returnPolicy' | 'shippingInfo' | 'shippingDays' | 'shippingRules'
  | 'workingHours' | 'payment' | 'kb' | 'logo' | 'social';

export interface StoreQualityItem {
  key: string;
  label: string;
  why: string;
  askPrompt: string;
  detect: string[];
  target: StoreQualityTarget;
  // آیتم‌های ارسال برای فروشگاه بدون ارسال حذف می‌شوند
  shippingOnly?: boolean;
  // فروشگاه بدون ارسال (خدمات/دوره) به‌جای ارسال این‌ها را می‌گیرد
  noShippingOnly?: boolean;
}

const it = (
  key: string, label: string, target: StoreQualityTarget, detect: string[] = [],
  extra: Partial<StoreQualityItem> = {},
): StoreQualityItem => ({
  key, label, target, detect,
  why: `مشتری‌ها قبل از خرید درباره‌ی «${label}» می‌پرسن؛ اگه جوابش توی فروشگاهت نباشه، بات یا جواب کلی می‌ده یا مکالمه به خودت می‌رسه.`,
  askPrompt: `«${label}» فروشگاهت چطوره؟`,
  ...extra,
});

export const STORE_COMMON_ITEMS: StoreQualityItem[] = [
  it('brand_intro', 'معرفی برند: چه می‌فروشی، برای کی، چرا به تو اعتماد کنند', 'brandIntro', [], { askPrompt: 'فروشگاهت چی می‌فروشه، برای کیه و چرا باید بهت اعتماد کنن (سابقه، تولیدی یا تأمین، تعداد مشتری)؟' }),
  it('shipping_days', 'زمان ارسال (حداقل/حداکثر روز)', 'shippingDays', [], { shippingOnly: true }),
  it('shipping_cost', 'هزینه‌ی ارسال (به تفکیک استان یا ثابت)', 'shippingRules', [], { shippingOnly: true }),
  it('return_policy', 'شرایط مرجوعی: مهلت، شرط سالم بودن، هزینه‌ی برگشت با کیست', 'returnPolicy', ['مرجوع', 'بازگشت', 'تعویض'], { askPrompt: 'شرایط مرجوعی چطوره؟ (چند روز مهلت، چه شرطی، هزینه‌ی برگشت با کیه)' }),
  it('payment', 'روش پرداخت', 'payment'),
  it('working_hours', 'ساعت پاسخ‌گویی', 'workingHours'),
  it('logo', 'لوگو', 'logo'),
  it('social', 'لینک اینستاگرام', 'social'),
  it('kb_min', 'حداقل ۵ سؤال پرتکرار در باکس دانش', 'kb'),
  it('no_vague', 'بدون ادعای تهی («بهترین کیفیت»، «ارسال فوری») بدون عدد و جزئیات', 'brandIntro', [], { askPrompt: 'به‌جای «ارسال فوری»، عدد و جزئیات واقعی بنویس (مثلاً «۲ تا ۴ روز کاری»).' }),
  // جایگزین ارسال برای فروشگاه بدون ارسال (خدمات/دوره)
  it('delivery_mode', 'نحوه‌ی ارائه (آنلاین/حضوری، آدرس یا منطقه، رزرو)', 'brandIntro', ['آنلاین', 'حضوری', 'آدرس', 'رزرو'], { noShippingOnly: true, askPrompt: 'خدمتت آنلاینه یا حضوری؟ آدرس/منطقه و نحوه‌ی رزرو چطوره؟' }),
];

const c = (items: [string, string, StoreQualityTarget, string[]?][]): StoreQualityItem[] =>
  items.map(([key, label, target, detect]) => it(key, label, target, detect ?? []));

const MEDICAL = c([
  ['mode_address', 'آنلاین/حضوری و آدرس یا محدوده', 'brandIntro', ['آنلاین', 'حضوری', 'آدرس']],
  ['booking_cancel', 'نحوه‌ی رزرو، لغو و جابه‌جایی', 'returnPolicy', ['رزرو', 'لغو', 'جابه‌جایی', 'جابجایی']],
  ['license', 'مجوز و سوابق', 'brandIntro', ['مجوز', 'سابقه', 'نظام']],
  ['deposit', 'بیعانه', 'returnPolicy', ['بیعانه', 'پیش‌پرداخت']],
]);

export const STORE_CATEGORY_ITEMS: Record<string, StoreQualityItem[]> = {
  'پوشاک': c([
    ['size_exchange', 'تعویض سایز (شرط و هزینه‌ی ارسال تعویض)', 'returnPolicy', ['تعویض']],
    ['origin', 'تولیدی خودتان یا تهیه از بازار/وارداتی', 'brandIntro', ['تولیدی', 'بازار', 'وارداتی', 'دوخت']],
    ['real_photos', 'عکس‌ها واقعی‌اند یا کاتالوگ', 'brandIntro', ['عکس واقعی', 'عکس‌ها واقعی', 'کاتالوگ']],
    ['city_ship', 'ارسال به شهرستان', 'shippingInfo', ['شهرستان', 'سراسر کشور']],
  ]),
  'کیف و کفش': c([
    ['shoe_exchange', 'تعویض سایز کفش', 'returnPolicy', ['تعویض']],
    ['leather_policy', 'طبیعی/مصنوعی بودن چرم به‌عنوان سیاست کلی', 'brandIntro', ['چرم', 'طبیعی', 'مصنوعی']],
    ['sew_warranty', 'ضمانت دوخت و زیره', 'returnPolicy', ['ضمانت', 'دوخت', 'زیره']],
  ]),
  'آرایشی و بهداشتی': c([
    ['authenticity', 'اصالت کالا (شرکتی، لیبل، کد ردیابی)', 'brandIntro', ['اصل', 'شرکتی', 'ردیابی', 'اورجینال']],
    ['opened_return', 'مرجوعی محصول باز شده (صریح بنویس)', 'returnPolicy', ['باز شده', 'پلمپ']],
    ['min_expiry', 'حداقل فاصله‌ی انقضا هنگام ارسال', 'brandIntro', ['انقضا']],
    ['summer_storage', 'نگهداری در ارسال تابستان', 'shippingInfo', ['تابستان', 'گرما', 'نگهداری']],
  ]),
  'خانه و آشپزخانه': c([
    ['shockproof', 'بسته‌بندی ضدضربه', 'shippingInfo', ['ضدضربه', 'ضربه', 'بسته‌بندی']],
    ['damage_liab', 'خسارت حین ارسال با کیست', 'returnPolicy', ['خسارت', 'شکستگی']],
    ['warranty', 'گارانتی', 'returnPolicy', ['گارانتی', 'ضمانت']],
  ]),
  'دیجیتال و لوازم جانبی': c([
    ['warranty_type', 'نوع گارانتی (شرکتی/فروشگاهی) و مدت', 'returnPolicy', ['گارانتی']],
    ['pre_test', 'تست قبل از ارسال', 'brandIntro', ['تست']],
    ['genuine_policy', 'سیاست اصل/های‌کپی', 'brandIntro', ['اصل', 'های‌کپی', 'های کپی']],
    ['compat_return', 'مرجوعی به‌خاطر ناسازگاری', 'returnPolicy', ['ناسازگار', 'سازگار']],
  ]),
  'خوراکی و صنایع غذایی': c([
    ['health_license', 'مجوز بهداشت/پروانه', 'brandIntro', ['پروانه', 'مجوز', 'بهداشت']],
    ['freshness', 'تازگی (تولید روزانه/هفتگی)', 'brandIntro', ['تازه', 'روزانه', 'هفتگی']],
    ['cold_ship', 'ارسال سرد و شهرهای قابل ارسال', 'shippingInfo', ['سرد', 'یخ', 'شهر']],
    ['wholesale', 'سفارش عمده', 'brandIntro', ['عمده']],
  ]),
  'کودک و نوزاد': c([
    ['safety_std', 'استاندارد ایمنی کالاها', 'brandIntro', ['استاندارد', 'ایمن']],
    ['size_exchange', 'تعویض سایز', 'returnPolicy', ['تعویض']],
    ['gift_pack', 'بسته‌بندی هدیه', 'shippingInfo', ['هدیه']],
  ]),
  'ورزش و سفر': c([
    ['warranty', 'گارانتی', 'returnPolicy', ['گارانتی', 'ضمانت']],
    ['size_exchange', 'تعویض سایز', 'returnPolicy', ['تعویض']],
    ['advice', 'مشاوره‌ی انتخاب', 'brandIntro', ['مشاوره']],
  ]),
  'جواهرات و اکسسوری': c([
    ['price_calc', 'نحوه‌ی محاسبه‌ی قیمت (قیمت روز، اجرت، سود)', 'brandIntro', ['اجرت', 'قیمت روز', 'سود']],
    ['invoice', 'فاکتور و شناسنامه', 'brandIntro', ['فاکتور', 'شناسنامه']],
    ['insured_ship', 'ارسال بیمه‌شده', 'shippingInfo', ['بیمه']],
    ['rebuy', 'خرید مجدد/تعویض', 'returnPolicy', ['تعویض', 'خرید مجدد', 'استرداد']],
    ['skin_allergy', 'برای بدلیجات: سیاست حساسیت پوستی', 'returnPolicy', ['حساسیت']],
  ]),
  'کتاب و لوازم‌التحریر': c([
    ['new_used', 'نو/دست‌دوم', 'brandIntro', ['نو', 'دست‌دوم', 'دست دوم']],
    ['unavailable', 'تهیه‌ی کتاب ناموجود', 'brandIntro', ['ناموجود', 'تهیه']],
    ['pack', 'بسته‌بندی', 'shippingInfo', ['بسته‌بندی']],
  ]),
  'گل و گیاه': c([
    ['city_post', 'ارسال درون‌شهری/پستی و شهرها', 'shippingInfo', ['درون‌شهری', 'پیک', 'پست']],
    ['health_guarantee', 'تضمین سلامت هنگام رسیدن', 'returnPolicy', ['سلامت', 'تضمین']],
    ['care_guide', 'راهنمای نگهداری بعد از خرید', 'brandIntro', ['نگهداری']],
  ]),
  'صنایع‌دستی': c([
    ['custom_time', 'زمان ساخت سفارش اختصاصی', 'brandIntro', ['سفارش اختصاصی', 'ساخت']],
    ['handmade_diff', 'تفاوت جزئی دست‌ساز با عکس', 'brandIntro', ['دست‌ساز', 'تفاوت']],
    ['abroad', 'ارسال به خارج', 'shippingInfo', ['خارج', 'بین‌المللی']],
  ]),
  'حیوانات خانگی': c([
    ['advice', 'مشاوره‌ی انتخاب غذا/لوازم', 'brandIntro', ['مشاوره']],
    ['expiry', 'تاریخ انقضا', 'brandIntro', ['انقضا']],
    ['brand_auth', 'اصالت برند', 'brandIntro', ['اصل', 'اصالت', 'برند']],
  ]),
  'دوره آموزشی و محصولات دیجیتال': c([
    ['delivery_access', 'نحوه‌ی تحویل و مدت دسترسی', 'brandIntro', ['تحویل', 'دسترسی']],
    ['support', 'پشتیبانی بعد از خرید', 'brandIntro', ['پشتیبانی']],
    ['refund', 'شرایط بازگشت وجه', 'returnPolicy', ['بازگشت وجه', 'استرداد']],
  ]),
  'فرش دستباف و عتیقه': c([
    ['certificate', 'شناسنامه/کارشناسی', 'brandIntro', ['شناسنامه', 'کارشناسی']],
    ['insured_ship', 'ارسال بیمه‌شده', 'shippingInfo', ['بیمه']],
    ['visit', 'بازدید حضوری', 'brandIntro', ['بازدید', 'حضوری']],
    ['wash_repair', 'خدمات شست‌وشو و رفو', 'brandIntro', ['شست', 'رفو']],
  ]),
  'خدمات تعمیر': c([
    ['scope', 'محدوده‌ی خدمات و برندها', 'brandIntro', ['برند', 'محدوده']],
    ['repair_warranty', 'گارانتی تعمیر', 'returnPolicy', ['گارانتی']],
    ['quote_fee', 'هزینه‌ی کارشناسی', 'brandIntro', ['کارشناسی']],
    ['courier', 'پیک دریافت/تحویل', 'shippingInfo', ['پیک']],
  ]),
  'پزشکی و دندان‌پزشکی': MEDICAL,
  'مشاوره': MEDICAL,
  'سالن زیبایی و آرایشگاه': MEDICAL,
  'آموزش خصوصی و مربی‌گری': MEDICAL,
  'سایر': [],
};

export function getStoreQualityGuide(category: string | null | undefined, requiresShipping: boolean): StoreQualityItem[] {
  const specific = (category && STORE_CATEGORY_ITEMS[category]) || [];
  return [...STORE_COMMON_ITEMS, ...specific].filter((i) => (requiresShipping ? !i.noShippingOnly : !i.shippingOnly));
}

export const STORE_GUIDE_CATEGORIES: readonly string[] = BUSINESS_CATEGORIES;
