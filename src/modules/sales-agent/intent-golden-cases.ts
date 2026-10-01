import type { ConversationState } from '@prisma/client';
import type { BuyerNeedTag, ParsedIntent } from './sales-agent.types';

// docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵.۴ — این یک eval-set دستی‌ساز (synthetic)
// است، نه جایگزین eval-set واقعی بخش ۵.۴ (که باید از پیام‌های واقعی مشتریان بعد از دیپلوی
// ساخته شود). هدف این‌جا فقط smoke-test سریع prompt/schema فعلی است — خصوصاً جفت‌های
// buyerNeeds که در buildIntentClassificationPrompt به‌عنوان «نزدیک به هم» علامت خورده‌اند —
// نه اندازه‌گیری آماری دقت روی ترافیک واقعی.
export interface IntentGoldenCase {
  id: string;
  message: string;
  state?: ConversationState;
  expectedIntent: ParsedIntent['intent'];
  // فقط subset-check می‌شود (همه‌ی این‌ها باید در خروجی باشند؛ برچسب اضافه fail نمی‌شود) —
  // چون چندبرچسبی‌بودن یعنی ممکن است مدل به‌درستی یک نیاز ریزتر هم تشخیص بدهد که اینجا
  // پیش‌بینی نشده
  expectedBuyerNeeds?: BuyerNeedTag[];
  notes?: string;
}

export const INTENT_GOLDEN_CASES: IntentGoldenCase[] = [
  // ── پوشش ۱۱ intent اجرایی ───────────────────────────────────────────────
  { id: 'i1', message: 'سلام، چی دارید؟', expectedIntent: 'BROWSE' },
  {
    id: 'i2',
    message: 'همین کفش مشکی رو بذار تو سبدم، یه جفت',
    expectedIntent: 'ADD_TO_CART',
  },
  {
    id: 'i3',
    message: 'اون شلوار رو از سبد بردار',
    expectedIntent: 'REMOVE_FROM_CART',
  },
  { id: 'i4', message: 'سبدم چیه الان؟', expectedIntent: 'VIEW_CART' },
  {
    id: 'i5',
    message: 'باشه همینا رو میخوام، بریم برای پرداخت',
    state: 'CART_REVIEW',
    expectedIntent: 'CHECKOUT',
  },
  {
    id: 'i6',
    message: 'بله تایید میکنم',
    state: 'CART_REVIEW',
    expectedIntent: 'CONFIRM',
  },
  { id: 'i7', message: 'نه بی‌خیال، پاکش کن', expectedIntent: 'CANCEL' },
  {
    id: 'i8',
    message: 'ساعت کاری فروشگاهتون چیه؟',
    expectedIntent: 'ASK_FAQ',
  },
  {
    id: 'i9',
    message: 'میخوام با خود پشتیبانی/انسان صحبت کنم',
    expectedIntent: 'REQUEST_HUMAN',
  },
  {
    id: 'i10',
    message: 'کد TAKH20 رو برام اعمال کن',
    state: 'CART_REVIEW',
    expectedIntent: 'APPLY_DISCOUNT',
  },
  {
    id: 'i11',
    message: 'اهوم بله شاید فردا پس فردا',
    expectedIntent: 'UNCLEAR',
  },

  // ── جفت‌های نزدیک به هم که در prompt صریح disambiguate شدند ─────────────
  {
    id: 'd1',
    message: 'این کتونی قیمتش چنده؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_PRICE'],
    notes: 'فقط استعلام قیمت، بدون درخواست تخفیف',
  },
  {
    id: 'd2',
    message: 'تخفیف هم می‌دید روی این محصول؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['REQUEST_DISCOUNT'],
  },
  {
    id: 'd3',
    message: 'یکم گرونه ها، میشه ارزون‌تر بدی؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['NEGOTIATE_PRICE'],
  },
  {
    id: 'd4',
    message: 'پوستم خیلی خشکه، چه کرمی مناسبمه؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PRODUCT_RECOMMENDATION'],
  },
  {
    id: 'd5',
    message: 'همین کرمی که نشونم دادی رو به نظرت بخرم؟ خوبه؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PURCHASE_HESITATION'],
  },
  {
    id: 'd6',
    message: 'بخش لوازم آرایشی فروشگاهتون کجاست؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_NAVIGATION_HELP'],
  },
  {
    id: 'd7',
    message: 'اصلا تو درست جواب نمیدی، هیچی حالیت نیست',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: ['BOT_FRUSTRATION'],
  },

  // ── چندبرچسبی (چند نیاز در یک پیام) ─────────────────────────────────────
  {
    id: 'm1',
    message: 'این کتونی سایز ۴۲ داره؟ و قیمتش چقدره؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['VARIANT_REQUEST', 'ASK_PRICE'],
  },
  {
    id: 'm2',
    message: 'کی میرسه دستم و هزینه ارسالش چقدره؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_SHIPPING'],
  },

  // ── نمونه‌ی خارج از taxonomy (باید unmatchedBuyerNeed پر شود) ───────────
  {
    id: 'u1',
    message: 'میشه روی بسته‌بندی محصول پرچم ایران چاپ کنید؟',
    expectedIntent: 'ASK_FAQ',
    notes: 'باید unmatchedBuyerNeed پر شود، نه یکی از ۳۶ تگ فعلی',
  },

  // ── گروه‌های P1 (باید buyerNeeds=PAYMENT_ISSUE / POST_PURCHASE_SUPPORT بدهد) ─
  {
    id: 'p1',
    message: 'من دیروز رسید پرداختو فرستادم ولی هنوز تایید نشده',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PAYMENT_ISSUE'],
  },
  {
    id: 'p2',
    message: 'سفارشی که هفته پیش ثبت کردم کی میرسه؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['POST_PURCHASE_SUPPORT'],
  },
  {
    id: 'p3',
    message:
      'کالایی که دستم رسید با چیزی که سفارش دادم فرق داره، میخوام برش گردونم',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['POST_PURCHASE_SUPPORT'],
  },

  // ── پوشش باقی‌مانده‌ی ۳۶ تگ (یک نمونه‌ی مستقیم برای هرکدام) ─────────────
  {
    id: 't1',
    message: 'جنسش از چیه؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PRODUCT_SPEC'],
  },
  {
    id: 't2',
    message: 'این دستگاه رو چطوری روشن کنم؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['USAGE_GUIDE'],
  },
  {
    id: 't3',
    message: 'الان موجوده این مدل؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['STOCK_CHECK'],
  },
  {
    id: 't4',
    message: 'این مدل رو با اون یکی که قبلا نشون دادی مقایسه کن',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PRODUCT_COMPARISON'],
  },
  {
    id: 't5',
    message: 'خریدارای قبلی چی گفتن درباره این محصول؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_REVIEWS'],
  },
  {
    id: 't6',
    message: 'این اورجینال اصله واقعا؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_AUTHENTICITY'],
  },
  {
    id: 't7',
    message: 'اگه نخوامش میتونم پسش بدم؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_WARRANTY_RETURN_POLICY'],
  },
  {
    id: 't8',
    message: 'شما نماد اعتماد دارید؟ معتبرید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_STORE_TRUST'],
  },
  {
    id: 't9',
    message: 'این با گوشی آیفون من سازگاره؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_COMPATIBILITY'],
  },
  {
    id: 't10',
    message: 'این مدل کی دوباره موجود میشه؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_RESTOCK_ETA'],
  },
  {
    id: 't11',
    message: 'پرداخت درب منزل هم دارید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_CASH_ON_DELIVERY'],
  },
  {
    id: 't12',
    message: 'برای عمده چقدر تخفیف میدید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_BULK_PURCHASE'],
  },
  {
    id: 't13',
    message: 'میشه اقساطی بخرمش؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['ASK_INSTALLMENT'],
  },
  {
    id: 't14',
    message: 'میشه چندتا عکس دیگه از زوایای مختلف بفرستی؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['REQUEST_MORE_PHOTOS'],
  },
  {
    id: 't15',
    message: 'ویدیوی این محصول رو داری؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['REQUEST_VIDEO'],
  },
  {
    id: 't16',
    message: 'عکسی دارم از یه مدل مشابه، میخوام ببینم دقیقا همینو دارید یا نه',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['IMAGE_SEARCH_REQUEST'],
  },
  {
    id: 't17',
    message: 'میشه روی این گردنبند اسم دخترم رو حک کنید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['CUSTOM_ORDER_REQUEST'],
  },
  {
    id: 't18',
    message: 'میخوام هدیه بدم، میشه قشنگ کادوپیچ کنید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['GIFT_WRAP_REQUEST'],
  },
  {
    id: 't19',
    message: 'وقتی موجود شد بهم خبر میدید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['RESTOCK_NOTIFY_REQUEST'],
  },
  {
    id: 't20',
    message: 'فاکتور رسمی هم صادر می‌کنید؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['REQUEST_INVOICE'],
  },
  {
    id: 't21',
    message: 'میشه این رو تا فردا برام نگه دارید، پیش‌خرید کنم؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['RESERVATION_PREORDER_REQUEST'],
  },
  {
    id: 't22',
    message: 'خیلی ممنون، عالی بود همه چی',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['POSITIVE_FEEDBACK'],
  },
  {
    id: 't23',
    message: 'تخفیف ویژه امروز فالو کن برنده شو لینک بیو',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: ['OFF_TOPIC_OR_SPAM'],
  },
  {
    id: 't24',
    message: 'قبل از اینکه بخرم میخوام با خود فروشنده صحبت کنم، سوال دارم',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['TALK_TO_SELLER'],
  },
];
