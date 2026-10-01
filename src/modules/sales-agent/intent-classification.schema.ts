import { z } from 'zod';
import type { ConversationState } from '@prisma/client';

// docs/PRD-buyer-purchase-intent-taxonomy.md — schema/prompt طبقه‌بندی intent از
// conversation-engine.service.ts (callParseIntent) استخراج شد تا sales-agent-qa.service.ts
// (تست دقت intent، بخش ۵.۴ سند) هم بتواند بدون کپی/دریفت همین schema/prompt دقیق را اجرا کند —
// تنها منبع واحد، هر دو caller از همین‌جا می‌خوانند.
export const intentClassificationSchema = z.object({
  intent: z.enum([
    'BROWSE',
    'ADD_TO_CART',
    'REMOVE_FROM_CART',
    'VIEW_CART',
    'CHECKOUT',
    'ASK_FAQ',
    'CONFIRM',
    'CANCEL',
    'REQUEST_HUMAN',
    'APPLY_DISCOUNT',
    'UNCLEAR',
  ]),
  // چون مدل از قبل دارد این پیام را طبقه‌بندی می‌کند، خواستن یک برچسب کیفی اطمینان هزینه‌ی
  // اضافه‌ای ندارد؛ عمداً enum کیفی (HIGH/MEDIUM/LOW) نه یک عدد اعشاری — مدل‌های زبانی در
  // گزارش عدد کالیبره‌شده ضعیف‌اند ولی در خودارزیابی کیفی قابل‌اتکاترند
  intentConfidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  productQuery: z.string().nullable(),
  productIndex: z.number().int().positive().nullable(),
  quantity: z.number().int().positive().nullable(),
  // docs/PRD-customer-comments-and-discounts.md بخش ۹ — فقط وقتی intent=APPLY_DISCOUNT
  discountCode: z.string().nullable(),
  // بخش ۴.۲ سند — لایه‌ی آنالیتیکس، چندبرچسبی، مستقل از intent بالا (که فقط تعیین می‌کند چه
  // Tool ای اجرا شود)
  buyerNeeds: z
    .array(
      z.enum([
        'PRODUCT_SPEC',
        'USAGE_GUIDE',
        'STOCK_CHECK',
        'VARIANT_REQUEST',
        'PRODUCT_COMPARISON',
        'PRODUCT_RECOMMENDATION',
        'ASK_REVIEWS',
        'ASK_AUTHENTICITY',
        'ASK_SHIPPING',
        'ASK_PAYMENT_METHODS',
        'ASK_WARRANTY_RETURN_POLICY',
        'ASK_STORE_TRUST',
        'ASK_COMPATIBILITY',
        'ASK_NAVIGATION_HELP',
        'ASK_RESTOCK_ETA',
        'ASK_CASH_ON_DELIVERY',
        'PURCHASE_HESITATION',
        'ASK_PRICE',
        'REQUEST_DISCOUNT',
        'NEGOTIATE_PRICE',
        'ASK_BULK_PURCHASE',
        'ASK_INSTALLMENT',
        'REQUEST_MORE_PHOTOS',
        'REQUEST_VIDEO',
        'IMAGE_SEARCH_REQUEST',
        'CUSTOM_ORDER_REQUEST',
        'GIFT_WRAP_REQUEST',
        'RESTOCK_NOTIFY_REQUEST',
        'REQUEST_INVOICE',
        'RESERVATION_PREORDER_REQUEST',
        'BOT_FRUSTRATION',
        'POSITIVE_FEEDBACK',
        'OFF_TOPIC_OR_SPAM',
        'TALK_TO_SELLER',
        'PAYMENT_ISSUE',
        'POST_PURCHASE_SUPPORT',
      ]),
    )
    .nullable(),
  unmatchedBuyerNeed: z.string().nullable(),
  // docs/PRD-sales-agent-implicit-need-detection.md بخش ۴.۱ — سه سیگنال مستقل، جدا از
  // intent/buyerNeeds بالا؛ هر سه «همیشه پر» هستند (نه nullable)، چون حتی وقتی نیازی نیست
  // (needType=NONE) باز هم یک مقدار صریح (NOT_RELEVANT/NOT_READY) معنادارتر از null است
  needType: z.enum(['EXPLICIT', 'IMPLICIT', 'NONE']),
  implicitNeedSummary: z.string().nullable(),
  storeRelevance: z.enum(['RELEVANT', 'POSSIBLY_RELEVANT', 'NOT_RELEVANT']),
  pitchReadiness: z.enum(['READY', 'NEEDS_CLARIFICATION', 'NOT_READY']),
});

export function buildIntentClassificationPrompt(
  state: ConversationState,
  // docs/PRD-sales-agent-implicit-need-detection.md بخش ۴.۱ — یک جمله‌ی کوتاه درباره‌ی اینکه
  // این فروشگاه چه می‌فروشد (از store.category/brandIntro ساخته می‌شود)، فقط برای سنجش خام
  // storeRelevance پایین؛ fit واقعی با کاتالوگ در فاز بعد (retrieval+fit-check روی خود doBrowse)
  // سنجیده می‌شود، نه اینجا — پس اگر این‌جا نامشخص باشد باید POSSIBLY_RELEVANT بگذاری، نه حدس قطعی
  storeContextSummary?: string | null,
): string {
  return `تو فقط یک استخراج‌کننده‌ی intent هستی، نه فروشنده — هیچ تصمیمی نمی‌گیری، فقط
پیام مشتری یک فروشگاه اینستاگرامی را دسته‌بندی می‌کنی.
وضعیت فعلی مکالمه: ${state}
زمینه‌ی فروشگاه (برای storeRelevance پایین): ${storeContextSummary || 'نامشخص'}
intent های ممکن:
- BROWSE: مشتری می‌خواهد محصولات را ببیند، درباره‌ی محصولی می‌پرسد، یا یک هدف/نیاز شخصی بیان
  می‌کند که به‌طور معقول با حوزه‌ی فروشگاه مرتبط است (حتی بدون اسم بردن از محصول خاص — مثلاً
  «میخوام فرانت‌اند دولوپر بشم» در فروشگاه آموزش React)
- ADD_TO_CART: می‌خواهد چیزی به سبد اضافه کند (productQuery=نام محصول یا productIndex=ارجاع ترتیبی مثل «اولی»/«دومی»، quantity=تعداد اگر گفته)
- REMOVE_FROM_CART: می‌خواهد چیزی از سبد حذف کند
- VIEW_CART: می‌خواهد سبدش را ببیند
- CHECKOUT: می‌خواهد سفارش نهایی/پرداخت کند
- CONFIRM: تایید می‌کند (مثلاً «بله»، «تایید»، «باشه» بعد از دیدن سبد)
- CANCEL: می‌خواهد لغو کند/سبد را خالی کند
- ASK_FAQ: سؤال عمومی (نه درباره‌ی یک محصول خاص برای اضافه‌کردن)
- REQUEST_HUMAN: صریحاً می‌خواهد با یک آدم واقعی صحبت کند
- APPLY_DISCOUNT: یک کد تخفیف دارد/می‌گوید (discountCode=همان کد، دقیقاً همانی که نوشته)
- UNCLEAR: نامفهوم، یا یک هدف/گپ شخصی که واقعاً هیچ ربطی به حوزه‌ی این فروشگاه ندارد (حتی اگر
  خودش کاملاً مفهوم باشد — مثلاً «میخوام مهاجرت کنم» در فروشگاه دوره‌ی React)

intentConfidence: چقدر مطمئنی که همین intent بالا درست است؟ HIGH (پیام صریح و بدون ابهام)،
MEDIUM (احتمالاً درست ولی پیام کمی مبهم/ناقص بود)، یا LOW (حدس زدی، پیام می‌توانست چند جور
تفسیر شود). این را با intent=UNCLEAR اشتباه نگیر — حتی وقتی مطمئن هستی که UNCLEAR درست است،
همان اطمینانت (معمولاً HIGH) را در intentConfidence بگذار؛ intentConfidence همیشه درباره‌ی
خودِ تشخیصت است، نه یک انتخاب جداگانه.

علاوه بر intent بالا، buyerNeeds را هم پر کن — یک یا چند برچسب از لیست زیر که واقعاً «نیاز»
خریدار را نشان می‌دهد (جدا از اینکه کدام Tool اجرا می‌شود؛ یک پیام می‌تواند چند نیاز داشته
باشد، مثلاً هم قیمت هم سایز). اگر هیچ‌کدام صدق نمی‌کند، آرایه‌ی خالی یا null بگذار:
- PRODUCT_SPEC: مشخصات فنی/جنس محصول
- USAGE_GUIDE: نحوه‌ی استفاده
- STOCK_CHECK: موجودی فعلی
- VARIANT_REQUEST: سایز/رنگ/مدل دیگر
- PRODUCT_COMPARISON: مقایسه‌ی دو یا چند محصول
- PRODUCT_RECOMMENDATION: درخواست پیشنهاد/راهنمایی خرید بر اساس نیاز
- ASK_REVIEWS: نظر خریداران قبلی
- ASK_AUTHENTICITY: اصالت کالا
- ASK_SHIPPING: زمان/هزینه‌ی ارسال
- ASK_PAYMENT_METHODS: روش‌های پرداخت (سوال، نه مشکل)
- ASK_WARRANTY_RETURN_POLICY: شرایط گارانتی/مرجوعی (سوال سیاست، نه درخواست واقعی)
- ASK_STORE_TRUST: اعتبار/اعتماد فروشگاه
- ASK_COMPATIBILITY: سازگاری با محصول/وسیله‌ی دیگر
- ASK_NAVIGATION_HELP: کمک برای پیدا کردن محصول/بخش فروشگاه
- ASK_RESTOCK_ETA: کی دوباره موجود می‌شود
- ASK_CASH_ON_DELIVERY: پرداخت درب منزل
- PURCHASE_HESITATION: تردید پیش از خرید، نیاز به اطمینان‌خاطر («به نظرت بخرمش؟»)
- ASK_PRICE: استعلام قیمت
- REQUEST_DISCOUNT: درخواست تخفیف عمومی (نه کد مشخص — آن APPLY_DISCOUNT است)
- NEGOTIATE_PRICE: چانه‌زنی روی قیمت
- ASK_BULK_PURCHASE: خرید عمده/همکاری
- ASK_INSTALLMENT: خرید اقساطی
- REQUEST_MORE_PHOTOS: درخواست عکس بیشتر
- REQUEST_VIDEO: درخواست ویدیو
- IMAGE_SEARCH_REQUEST: می‌خواهد با عکس جست‌وجو کند («این مدل رو دارید؟» + عکس یا توصیف عکس)
- CUSTOM_ORDER_REQUEST: سفارشی‌سازی محصول
- GIFT_WRAP_REQUEST: بسته‌بندی هدیه
- RESTOCK_NOTIFY_REQUEST: درخواست اطلاع‌رسانی وقتی موجود شد
- REQUEST_INVOICE: درخواست فاکتور رسمی
- RESERVATION_PREORDER_REQUEST: درخواست رزرو یا پیش‌سفارش
- BOT_FRUSTRATION: نارضایتی از خود ربات/عدم درک
- POSITIVE_FEEDBACK: بازخورد مثبت/تشکر/رضایت
- OFF_TOPIC_OR_SPAM: فقط تبلیغ/اسپم/محتوای بی‌معنای مکالمه‌ای واقعی (مثلاً «فالو کن برنده شو
  لینک بیو») — هرگز برای یک هدف/گفتگوی شخصیِ واقعی که فقط نامرتبط با این فروشگاه است استفاده
  نکن؛ آن حالت را با storeRelevance=NOT_RELEVANT پایین مشخص کن، نه این برچسب
- TALK_TO_SELLER: می‌خواهد پیش از خرید (نه از سردرگمی) با خود فروشنده صحبت کند
- PAYMENT_ISSUE: مشکل در پرداخت کارت‌به‌کارت (رسید تایید نشده، مبلغ اشتباه و مشابه — توجه:
  فروشگاه فقط کارت‌به‌کارت دارد، نه درگاه بانکی)
- POST_PURCHASE_SUPPORT: هر مشکل بعد از ثبت سفارش (پیگیری/لغو/تغییر آدرس/شکایت/مرجوعی/تعویض/
  مغایرت کالا/مشکل تحویل/پیگیری بازپرداخت) — یک تگ عمومی، نیازی به تفکیک ریز نیست

چند نکته برای جلوگیری از اشتباه بین برچسب‌های نزدیک به هم:
- ASK_PRICE فقط «قیمتش چنده؟» است؛ REQUEST_DISCOUNT وقتی مشتری می‌پرسد آیا اصلاً تخفیفی هست
  («تخفیف می‌دید؟»)؛ NEGOTIATE_PRICE وقتی مشتری دارد چانه می‌زند/می‌خواهد مبلغ را پایین بیاورد
  («ارزون‌تر بده»، «گرونه»). یک پیام می‌تواند هم ASK_PRICE هم یکی از آن دو باشد.
- PRODUCT_RECOMMENDATION وقتی مشتری از صفر راهنمایی/پیشنهاد می‌خواهد بدون محصول مشخص در ذهن
  («برای پوست خشک چی مناسبه؟»)؛ PURCHASE_HESITATION وقتی مشتری از قبل یک محصول مشخص را
  می‌بیند/می‌شناسد و فقط دنبال تاییدیه/اطمینان‌خاطر است («همینو بخرم به نظرت؟»)؛
  ASK_NAVIGATION_HELP وقتی فقط دنبال پیدا کردن یک بخش/دسته از فروشگاه است، نه توصیه
  («لباس بچگانه کجاست؟»).
- BOT_FRUSTRATION فقط وقتی نارضایتی از خودِ ربات/مکالمه است (مثل «تو اصلا نمی‌فهمی چی میگم»)،
  نه نارضایتی از محصول/سفارش (آن POST_PURCHASE_SUPPORT یا یک شکایت است).

اگر پیام واضح یک نیاز واقعی دارد ولی با هیچ‌کدام از موارد بالا جور نیست، آن را در
unmatchedBuyerNeed با جمله‌ی کوتاه خودت (نه یکی از enum های بالا) بنویس؛ در غیر این صورت null.

علاوه‌بر همه‌ی موارد بالا، این ۴ فیلد را هم همیشه پر کن — این‌ها مستقل از intent/buyerNeeds‌اند و
دقیقاً برای تشخیص هدف/آرزوی شخصیِ مشتری (نه فقط درخواست صریح محصول) طراحی شده‌اند:

needType — آیا پشت این پیام یک «نیاز» واقعی هست؟
- EXPLICIT: مستقیم یک محصول/دسته‌ی مشخص خواسته («یه دوره React میخوام»)
- IMPLICIT: یک هدف/مشکل/آرزوی شخصی بیان کرده بدون درخواست مستقیم یک راه‌حل («میخوام فرانت‌اند
  دولوپر بشم»، «پوستم خشکه»)
- NONE: هیچ نیاز خریدی در این پیام نیست (سلام خشک، گپ عادی، تشکر، گله از ربات)

implicitNeedSummary: اگر needType≠NONE، خلاصه‌ی یک‌خطی فارسی از خودِ هدف واقعی مشتری (نه اسم
محصول) — مثلاً «می‌خواهد فرانت‌اند دولوپر شود». اگر needType=NONE، حتماً null.

storeRelevance — با توجه به «زمینه‌ی فروشگاه» بالا، این نیاز اصلاً ربطی به چیزی دارد که این
فروشگاه می‌فروشد؟
- RELEVANT: واضح مرتبط
- POSSIBLY_RELEVANT: شاید مرتبط باشد ولی مطمئن نیستی، یا زمینه‌ی فروشگاه «نامشخص» بود
- NOT_RELEVANT: واضح نامرتبط (مثلاً هدف مهاجرت در فروشگاه دوره‌ی برنامه‌نویسی)
اگر needType=NONE، همیشه NOT_RELEVANT بگذار.

pitchReadiness — اگر storeRelevance≠NOT_RELEVANT، همین الان اطلاعات کافی برای یک پیشنهاد دقیق
هست؟ (این فقط یک حدس اولیه است؛ تصمیم نهایی بعداً با چک‌کردن کاتالوگ واقعی گرفته می‌شود)
- READY: نیاز به‌اندازه‌ی کافی مشخص است (برای EXPLICIT تقریباً همیشه READY)
- NEEDS_CLARIFICATION: نیاز خیلی کلی/مبهم است («میخوام برنامه‌نویسی یاد بگیرم» بدون مشخص‌کردن
  زمینه، وقتی چند گزینه‌ی خیلی متفاوت ممکن است جواب باشد)
- NOT_READY: زود است یا storeRelevance=NOT_RELEVANT/POSSIBLY_RELEVANT

قانون حیاتی (دقیقاً همین‌جا بود که تشخیص قبلی اشتباه می‌کرد): یک هدف/آرزوی شخصیِ واقعی هرگز
OFF_TOPIC_OR_SPAM نیست، حتی اگر با این فروشگاه نامرتبط باشد — OFF_TOPIC_OR_SPAM فقط برای اسپم/
تبلیغ واقعی است (تعریف دقیق‌تر بالا). همیشه این سه مثال را به‌عنوان مرجع نگه دار:

۱. «میخوام برم فرانت‌اند دولوپر بشم» + زمینه‌ی فروشگاه «آموزش React/فرانت‌اند می‌فروشد»:
   intent=BROWSE (نه UNCLEAR)، needType=IMPLICIT،
   implicitNeedSummary="می‌خواهد فرانت‌اند دولوپر شود"، storeRelevance=RELEVANT،
   pitchReadiness=READY، buyerNeeds باید خالی باشد (نه OFF_TOPIC_OR_SPAM)
۲. «میخوام مهاجرت کنم» با هر زمینه‌ی فروشگاهی که واضحاً بی‌ربط است: intent=UNCLEAR،
   needType=IMPLICIT، implicitNeedSummary="می‌خواهد مهاجرت کند"، storeRelevance=NOT_RELEVANT،
   pitchReadiness=NOT_READY، buyerNeeds خالی (نه OFF_TOPIC_OR_SPAM — این اسپم نیست)
۳. «میخوام برنامه‌نویسی یاد بگیرم» + زمینه‌ی فروشگاه با چند دوره‌ی خیلی متفاوت: intent=BROWSE،
   needType=IMPLICIT، storeRelevance=RELEVANT، pitchReadiness=NEEDS_CLARIFICATION (باید اول یک
   سوال مشخص‌کننده بپرسد، نه این‌که کورکورانه یک دوره را حدس بزند)
۴. «تخفیف ویژه امروز فالو کن برنده شو لینک بیو»: intent=UNCLEAR، needType=NONE،
   storeRelevance=NOT_RELEVANT، pitchReadiness=NOT_READY، buyerNeeds=[OFF_TOPIC_OR_SPAM] (این
   واقعاً اسپم/تبلیغ است، نه یک هدف شخصی)

فقط JSON مطابق schema برگردان.`;
}
