export const fa = {
  validation: {
    phoneInvalid: 'شماره موبایل معتبر نیست',
    otpLength: 'کد تأیید باید ۶ رقم باشد',
    otpDigitsOnly: 'کد تأیید باید فقط عدد باشد',
    required: 'این فیلد الزامی است',
    stringTooLong: 'متن وارد شده بیش از حد مجاز است',
    mustBeNumber: 'مقدار باید عدد صحیح باشد',
    numberPositive: 'مقدار باید صفر یا بیشتر باشد',
    mustBeArray: 'مقدار باید آرایه باشد',
    mustBeBoolean: 'مقدار باید درست یا غلط باشد',
  },
  auth: {
    otpSent: 'کد تأیید ارسال شد',
    otpExpired: 'کد تأیید منقضی شده است',
    otpInvalid: 'کد تأیید اشتباه است',
    otpTooManyRequests: (minutes: number) =>
      `تعداد درخواست بیش از حد مجاز است. لطفاً ${minutes.toLocaleString('fa-IR')} دقیقه صبر کنید`,
    otpTooManyAttempts: (minutes: number) =>
      `تعداد تلاش‌های ناموفق زیاد است. لطفاً ${minutes.toLocaleString('fa-IR')} دقیقه صبر کنید`,
    unauthorized: 'دسترسی غیرمجاز',
    tokenExpired: 'نشست شما منقضی شده است',
    refreshTokenInvalid: 'توکن نامعتبر است',
    userDisabled: 'حساب کاربری شما غیرفعال شده است',
  },
  conversations: {
    notFound: 'مکالمه یافت نشد',
    forbidden: 'دسترسی به این مکالمه مجاز نیست',
    updated: 'مکالمه به‌روز شد',
    deleted: 'مکالمه حذف شد',
  },
  chat: {
    quotaExceeded: 'سهمیه توکن روزانه شما تمام شده است. پلن خود را ارتقا دهید',
    monthlyQuotaExceeded: 'سهمیه ماهانه شما تمام شده است',
    modelNotAllowed: 'این مدل در پلن فعلی شما در دسترس نیست',
    streamError: 'خطا در دریافت پاسخ. دوباره تلاش کنید',
    modelUnavailable:
      'این مدل موقتاً در دسترس نیست. لطفاً مدل دیگری انتخاب کنید یا دوباره تلاش کنید',
    conversationNotFound: 'مکالمه یافت نشد',
    inputTooLong: (limit: number) =>
      `پیام شما بیش از ${limit} توکن است. لطفاً آن را کوتاه‌تر کنید`,
    budgetExceeded:
      'توکن روزانه‌ی شما تمام شده است. برای ادامه، پلن خود را ارتقا دهید.',
    walletInsufficient: 'موجودی کیف پول برای ادامه کافی نیست',
    dailyMessageLimitExceeded: 'به سقف پیام روزانه رسیدید',
    dailyBlocked:
      'به محدودیت پیام روزانه رسیدید. برای ارسال پیام بیشتر پلن خود را ارتقا دهید.',
    throttledNotice: 'پیام‌های باقی‌مانده امروز با محدودیت توکن ارسال می‌شوند',
    rollingWindowBlocked: (hours: number) =>
      `تعداد پیام‌های شما در ${hours} ساعت اخیر به سقف مجاز رسیده.`,
    imageGenNotSupported:
      'پلن فعلی شما امکان تولید عکس را ندارد. برای استفاده از این قابلیت، پلن خود را ارتقا دهید.',
    imageGenFailed: 'تولید عکس ناموفق بود. دوباره تلاش کنید',
    imageGenModelUnavailable:
      'تولید عکس با این مدل ناموفق بود. لطفاً مدل دیگری انتخاب کنید یا کمی بعد دوباره امتحان کنید.',
    imageGenPolicyViolation:
      'این درخواست به‌خاطر سیاست‌های ایمنی محتوا رد شد. لطفاً توصیف دیگری امتحان کنید.',
    imageGenRateLimited:
      'به سقف تعداد درخواست تولید/ویرایش عکس این پلن رسیده‌اید. کمی بعد دوباره امتحان کنید.',
    webSearchNotSupported:
      'این مدل جستجوی وب را پشتیبانی نمی‌کند. لطفاً مدل دیگری انتخاب کنید یا جستجو را خاموش کنید.',
    promptReviewFailed: 'بررسی پرامپت الان جواب نداد، دوباره امتحان کن',
    editMessageNotFound: 'پیام مورد نظر برای ویرایش یافت نشد',
    editOnlyUserMessage: 'فقط پیام‌های خودتان قابل ویرایش‌اند',
    editAttachmentNotSupported:
      'ویرایش پیام‌های دارای عکس/فایل پیوست هنوز پشتیبانی نمی‌شود',
  },
  payment: {
    pending: 'در انتظار پرداخت',
    success: 'پرداخت موفق بود',
    failed: 'پرداخت ناموفق بود. در صورت کسر وجه، تا ۷۲ ساعت برگشت می‌خورد',
    alreadyVerified: 'این پرداخت قبلاً تأیید شده است',
    notFound: 'پرداخت یافت نشد',
    invalidStatus: 'وضعیت پرداخت نامعتبر است',
    description: (planName: string) => `خرید اشتراک ${planName}`,
    walletTopupDescription: 'شارژ کیف‌پول',
    // docs/PRD-seller-credit-billing.md بخش ۷
    storeCreditTopupDescription: 'خرید اعتبار هوش مصنوعی فروشگاه',
    gatewayError: 'خطا در اتصال به درگاه پرداخت',
    gatewayRequired: 'انتخاب درگاه پرداخت الزامی است',
    gatewayNotEnabled: 'این درگاه پرداخت فعال نیست',
    bazaarInvalidPurchase:
      'این خرید در کافه‌بازار تأیید نشد. اگر مبلغی کسر شده تا ۷۲ ساعت برگشت می‌خورد',
    bazaarPackageNotSupported: 'این بسته از طریق کافه‌بازار قابل خرید نیست',
  },
  payAsYouGo: {
    notConfigured: 'پلن Pay-as-you-go در حال حاضر تنظیم نشده است',
    minActivation: (min: number) =>
      `برای فعال‌سازی اولیه حداقل باید ${min.toLocaleString('fa-IR')} تومان شارژ کنید`,
    minTopup: (min: number) =>
      `حداقل مبلغ شارژ ${min.toLocaleString('fa-IR')} تومان است`,
    insufficientBalance: 'موجودی کیف‌پول کافی نیست. لطفاً شارژ کنید',
    messageDebitDescription: 'مصرف پیام چت (Pay-as-you-go)',
    adminRefundDescription: 'بازگشت وجه توسط ادمین (خروج از Pay-as-you-go)',
  },
  invoice: {
    notFound: 'فاکتور یافت نشد',
  },
  discount: {
    invalidCode: 'کد تخفیف نامعتبر یا منقضی‌شده است',
    generationFailed: 'خطا در ساخت کد تخفیف. دوباره تلاش کنید',
    notEligible: 'شما واجد شرایط دریافت این هدیه نیستید',
  },
  subscription: {
    activated: 'اشتراک شما فعال شد',
    alreadyActive: 'شما از قبل اشتراک فعال دارید',
    cancelled: 'اشتراک در پایان دوره لغو خواهد شد',
    expired: 'اشتراک شما منقضی شده است',
    notFound: 'اشتراک فعالی یافت نشد',
  },
  plans: {
    notFound: 'پلن یافت نشد',
    notActive: 'این پلن در حال حاضر قابل خرید نیست',
    created: 'پلن با موفقیت ایجاد شد',
    updated: 'پلن با موفقیت به‌روز شد',
    deleted: 'پلن با موفقیت حذف شد',
    downgradeOrRepurchaseNotAllowed: (currentPlanName: string) =>
      `شما پلن «${currentPlanName}» فعال دارید. برای تعویض پلن، صبر کنید دوره‌ی فعلی تمام شود یا یک پلن بالاتر انتخاب کنید.`,
  },
  errors: {
    notFound: 'مورد درخواستی یافت نشد',
    forbidden: 'دسترسی مجاز نیست',
    validation: 'اطلاعات وارد شده معتبر نیست',
    internal: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید',
    tooManyRequests: 'تعداد درخواست‌ها بیش از حد مجاز است',
  },
  store: {
    notFound: 'فروشگاه یافت نشد',
    forbidden: 'دسترسی به این فروشگاه مجاز نیست',
    slugTaken: 'این نام برای لینک قبلاً استفاده شده است',
    slugInvalid:
      'نام لینک فقط می‌تواند از حروف انگلیسی کوچک، عدد و خط تیره باشد',
    bankCardInvalid: 'شماره کارت باید ۱۶ رقم باشد',
    productNotFound: 'محصول یافت نشد',
    noFileUploaded: 'فایلی ارسال نشده',
    excelOnly: 'فقط فایل اکسل (.xlsx یا .xls) پذیرفته می‌شود',
    excelUnreadable: 'فایل اکسل قابل خواندن نیست',
    excelEmpty: 'فایل اکسل خالی است',
    excelUnknownColumns:
      'فرمت ستون‌های فایل اکسل شناخته نشد — ستون‌های مورد انتظار: نام، قیمت، موجودی',
    noReceiptImage: 'برای این سفارش رسیدی ثبت نشده',
    tooManyImages: 'هر محصول حداکثر ۴ عکس می‌تواند داشته باشد',
    imageOnly: 'فقط فایل تصویر پذیرفته می‌شود',
    logoNotFound: 'عکس پروفایل فروشگاه یافت نشد',
    // docs/PRD-product-video.md
    tooManyVideos: 'هر محصول حداکثر ۴ ویدیو می‌تواند داشته باشد',
    videoOnly: 'فقط فایل ویدیو (mp4 یا mov) پذیرفته می‌شود',
    videoTooLarge: 'حجم ویدیو نباید بیشتر از ۵۰ مگابایت باشد',
    videoTooLong: 'مدت ویدیو نباید بیشتر از ۹۰ ثانیه باشد',
    videoTranscodeFailed:
      'پردازش ویدیو با مشکل مواجه شد، فایل دیگه‌ای امتحان کن',
    videoNotFound: 'ویدیوی محصول یافت نشد',
    bankCardNotFound: 'این کارت بانکی یافت نشد',
    lastActiveBankCard: 'حداقل یک کارت بانکی باید فعال بماند',
    urlNotReadable:
      'نتونستیم این لینک رو بخونیم — لطفاً اطلاعات محصول رو دستی وارد کن',
    insufficientCreditForWebSearch:
      'اعتبار فروشگاه برای تکمیل با جستجوی وب کافی نیست — از بخش «اعتبار هوش مصنوعی» شارژ کن',
    // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (دوم، مورد ۵)
    insufficientCreditForPhotoEnrichment:
      'اعتبار فروشگاه برای تکمیل از روی عکس کافی نیست — از بخش «اعتبار هوش مصنوعی» شارژ کن',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (رصد رقبا)
    brandIntroTextRequired: 'لطفاً چند جمله درباره‌ی برند/فروشگاهت بنویس',
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۱ — دستیار «نوشتن توضیحات با کمک AI» از روی یادداشت خام فروشنده
    productNotesRequired: 'لطفاً چیزی که درباره‌ی این محصول می‌دونی بنویس',
    productCodeTaken:
      'این کد قبلاً برای محصول دیگری در همین فروشگاه استفاده شده',
    // docs/PRD-product-display-focus-and-variations.md §۴.۱
    variantOptionNamesDuplicate: 'اسم گزینه‌ها باید با هم فرق داشته باشند',
    variantCombinationInvalid:
      'یکی از ترکیب‌ها با گزینه‌های تعریف‌شده جور نیست',
    variantCombinationDuplicate: 'یک ترکیب تکراری در لیست وجود دارد',
    // docs/PRD-product-display-focus-and-variations.md §۴.۱.۱ (فاز ۲)
    variantOptionsTextRequired:
      'لطفاً گزینه‌ها رو توضیح بده (مثلاً سایز و رنگ‌بندی)',
    // docs/PRD-bulk-product-import-from-document.md — افزودن/آپدیت دسته‌جمعی محصول از فایل/متن/صوت
    bulkImportTextRequired: 'لطفاً توضیحات محصولات رو بنویس یا فایل/صوت رو آپلود کن',
    telegramConnectTokenInvalid: 'این توکن اتصال تلگرام نامعتبر یا منقضی شده',
    // docs/PRD-customer-comments-and-discounts.md بخش ۷/۸
    discountCodeNotFound: 'این کد تخفیف یافت نشد',
    discountCodeTaken: 'این کد قبلاً در همین فروشگاه تعریف شده',
    discountCodeInvalidFormat:
      'کد تخفیف فقط می‌تواند از حروف/عدد انگلیسی و ۳ تا ۲۰ کاراکتر باشد',
    discountPercentTooHigh: 'درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲
    invalidTimeFormat: 'فرمت ساعت باید به شکل HH:mm باشد (مثلاً 09:00)',
    // docs/PRD-seller-advertising-placements.md
    adPlacementInsufficientBalance:
      'اعتبار فروشگاه برای خرید این جایگاه تبلیغاتی کافی نیست — از بخش «اعتبار هوش مصنوعی» شارژ کن',
    // docs/PRD-admin-product-enrichment-review.md
    enrichmentActiveDraftExists:
      'این محصول همین الان یک پیش‌نویس فعال دارد — اول همان را تایید/رد کن',
    enrichmentDraftNotFound: 'پیش‌نویسی برای تایید/رد یافت نشد',
    enrichmentDraftWrongStatus:
      'این پیش‌نویس در وضعیتی نیست که این اکشن روی آن ممکن باشد',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲
    shippingRuleNotFound: 'این قانون ارسال یافت نشد',
    shippingDefaultRuleDuplicate:
      'یک ردیف «ارسال به کل ایران» از قبل برای این فروشگاه تعریف شده',
    // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۱.۲ — سه خروجی CSV فروشنده
    csvOrdersHeader: [
      'تاریخ',
      'محصولات',
      'مبلغ (تومان)',
      'وضعیت',
      'استان',
      'آدرس',
      'گیرنده',
      'تلفن گیرنده',
    ],
    csvOrderStatusLabels: {
      PENDING_PAYMENT: 'در انتظار پرداخت',
      RECEIPT_SUBMITTED: 'رسید ارسال‌شده',
      APPROVED: 'تاییدشده',
      REJECTED: 'ردشده',
    } as Record<string, string>,
    csvProductsHeader: [
      'نام محصول',
      'قیمت (تومان)',
      'موجودی',
      'تعداد فروش‌رفته',
    ],
    csvCreditUsageHeader: [
      'تاریخ',
      'نوع مصرف',
      'مبلغ (تومان)',
      'از سهمیه‌ی رایگان',
    ],
    csvCreditUsageKindLabels: {
      TEXT_REPLY: 'پاسخ متنی',
      VOICE_TTS: 'پاسخ صوتی',
      ASR: 'تشخیص گفتار',
      TOPUP: 'شارژ اعتبار',
      PRODUCT_ENRICHMENT: 'تکمیل محصول با AI',
      AD_PLACEMENT: 'خرید جایگاه تبلیغاتی',
    } as Record<string, string>,
    csvCreditUsageFreeYes: 'بله',
    csvCreditUsageFreeNo: 'خیر',
  },
  storeKb: {
    notFound: 'این مورد در باکس دانش یافت نشد',
    invalidFile: 'فرمت فایل پذیرفته نیست — فقط PDF، Word، Excel یا متن ساده',
  },
  salesAgent: {
    invalidSession: 'نشست معتبر نیست',
    conversationNotFound: 'مکالمه یافت نشد',
    orderNotFound: 'سفارش یافت نشد',
    nothingToConfirm: 'چیزی برای تایید نیست — اول یک محصول به سبد اضافه کن',
    didNotUnderstand: 'متوجه نشدم، می‌تونی دوباره بگی چی می‌خوای؟',
    // فیدبک کاربر: پیام صوتی وب قبلاً در خطای ASR/ترنسکود یک 500 خام می‌گرفت؛ حالا مثل تلگرام
    // یک پاسخ عادی و راهنما برمی‌گردد
    voiceProcessingFailed:
      'متأسفانه نتونستم پیام صوتی رو پردازش کنم 🙏 میشه لطفاً به‌صورت متن بفرستی؟',
    didNotUnderstandWithHint: (productNames: string[]) =>
      `متوجه نشدم 🙁 می‌تونی مثلاً بگی «${productNames.join('» یا «')} رو میخوام» یا از لیست بالا دکمه‌ی «افزودن به سبد» رو بزنی.`,
    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۵) — به‌جای فقط «خوش اومدی»،
    // ۲-۳ نمونه‌ی کار واقعی که خریدار می‌تواند بخواهد (خیلی‌ها توانایی واقعی ایجنت را نمی‌دانند)
    firstGreeting: (storeName: string) =>
      `سلام! به ${storeName} خوش اومدی 👋 می‌تونی عکس بیشتر بخوای، قیمت/موجودی بپرسی، یا مستقیم اسم محصول رو بگی تا برات سفارش بدم.`,
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۲ — خریدار برگشتی (سفارش تاییدشده‌ی
    // قبلی از همین Customer، در یک مکالمه‌ی دیگر) به‌جای پیام خوش‌آمد عمومی این را می‌بیند
    returningGreeting: (storeName: string, productName: string) =>
      `خوش برگشتی به ${storeName}! 👋 دفعه‌ی قبل ${productName} رو خریدی. برای این دفعه فقط اسم محصول رو بگو یا از دکمه‌های پایین لیست استفاده کن.`,
    // docs/PRD-product-display-focus-and-variations.md §۳ — جایگاه تبلیغاتی GREETING_FEATURED_PRODUCT؛
    // بعد از متن خوش‌آمد عادی (عمومی/برگشتی) اضافه می‌شود، جایگزینش نمی‌کند
    featuredProductPromo: (productName: string) =>
      `✨ پیشنهاد ویژه‌ی این فروشگاه: ${productName}!`,
    addToCartAction: 'محصول رو به سبد اضافه کن',
    addToCartActionNamed: (productName: string) =>
      `${productName} رو به سبد اضافه کن`,
    confirmCartAction: 'تایید و پرداخت',
    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸)
    saveProductActionNamed: (productName: string) =>
      `${productName} رو برای بعد ذخیره کن`,
    unsaveProductActionNamed: (productName: string) =>
      `${productName} رو از ذخیره‌شده‌ها حذف کن`,
    productSaved: (productName: string) => `${productName} ذخیره شد ✅`,
    productUnsaved: (productName: string) => `${productName} از ذخیره‌شده‌ها حذف شد`,
    viewOrdersAction: 'سفارش‌های قبلیم رو نشون بده',
    noPreviousOrders: 'هنوز هیچ سفارشی ثبت نکردی',
    reorderAction: 'دوباره همینو سفارش بده',
    reorderNotFound: 'این سفارش رو پیدا نکردم',
    reorderOutOfStock: 'متاسفانه هیچ‌کدوم از آیتم‌های این سفارش دیگه موجود نیستن',
    noProductsFound: 'محصولی با این مشخصات پیدا نکردم',
    // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱ (Track A، ردیف askClarifyingQuestion)
    // — fallback وقتی هر دو تلاش AI برای ساخت سوال روشن‌کننده شکست بخورد
    clarifyNeedFallback:
      'دوست دارم دقیق‌تر کمکت کنم — می‌تونی بیشتر توضیح بدی دنبال چی هستی؟',
    productNotFound: 'این محصول رو پیدا نکردم، می‌تونی دوباره اسمش رو بگی؟',
    insufficientStock: 'موجودی این محصول کافی نیست',
    cartEmpty: 'سبد خرید خالی است',
    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — عیناً سبک addressAskProvince:
    // متن کوتاه + لیست مقادیر از خودِ چیپ‌ها (VARIANT_PROMPT) خوانده می‌شود، نه این‌جا تکرار
    variantAskOption: (optionName: string) => `${optionName} رو انتخاب کن 👇`,
    variantValueNotRecognized: (optionName: string) =>
      `متوجه نشدم 🙁 لطفاً یکی از گزینه‌های «${optionName}» رو از دکمه‌های بالا انتخاب کن`,
    variantOutOfStockAlternatives:
      'این ترکیب فعلاً تموم شده — این‌ها موجودن 👇',
    variantNoAlternatives: 'متاسفانه الان هیچ ترکیبی از این محصول موجود نیست',
    cartCleared: 'سبد خرید خالی شد',
    noPendingOrder: 'سفارشی در انتظار پرداخت پیدا نکردم',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — جواب ثابت وقتی مشتری صریح عکس
    // بیشتر خواسته و محصول پیدا شد (نه caption تولیدی، چون خودِ عکس‌ها پیام اصلی‌اند)
    photosCaption: (productName: string) => `عکس‌های ${productName} 📸`,
    receiptReceived: 'رسید دریافت شد و برای فروشنده ارسال شد — منتظر تایید باش',
    faqStub: 'این سؤال رو یادداشت کردم، به‌زودی جواب می‌دم',
    handoffToHuman: 'الان شما رو به یکی از همکارها وصل می‌کنم',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — وقتی Store.workingHoursStart/End
    // ست شده و الان بیرون این بازه‌ایم
    handoffToHumanOutOfHours:
      'الان خارج از ساعت پاسخ‌گویی فروشگاهیم؛ به‌محض شروع ساعت کاری بهتون جواب می‌دن 🙏',
    // docs/PRD-seller-credit-billing.md بخش ۳ — وقتی هم سهمیه‌ی رایگان تمام شده هم اعتبار
    // فروشگاه صفر/منفی است؛ عمداً پیام ثابت (نه LLM-generated، چون این مسیر اصلاً AI صدا نمی‌زند)
    billingBlockedHandoff: 'فروشنده به‌زودی شخصاً بهتون جواب می‌ده',
    // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۲ — مشکلات پرداخت کارت‌به‌کارت و هر
    // موضوع پس از خرید (P1)؛ ربات فعلاً Tool ای برای حلشان ندارد، مستقیم به فروشنده ارجاع می‌شود
    supportNeededHandoff:
      'این موضوع رو به فروشنده اطلاع دادم، به‌زودی خودش بهتون پیام می‌ده 🙏',
    // docs/PRD-buyer-abuse-rate-limit.md — فقط یک‌بار (لحظه‌ی قفل‌شدن) نشان داده می‌شود، بعدش سکوت کامل
    abuseLocked: 'یکم آروم‌تر 🙏 لطفاً چند دقیقه صبر کن و دوباره پیام بده',
    // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — بعد از تایید سفارش، پیام ثابت
    // (نه LLM-generated) که یک پیام آزاد بعدی مشتری را به یک ProductComment تبدیل می‌کند
    reviewFollowUpPrompt:
      'سفارشت تایید شد ✅ امیدواریم راضی باشی 🙏 اگه دوست داری نظرت رو درباره‌ی خرید یا محصول همین‌جا برام بنویس، به بقیه هم کمک می‌کنه.',
    reviewThanks: 'ممنون بابت نظرت! بعد از بررسی نمایش داده می‌شه 🙏',
    // docs/PRD-customer-comments-and-discounts.md بخش ۹
    discountCodeMissing: 'کد تخفیف رو متوجه نشدم، می‌تونی دوباره بگی؟',
    discountCodeInvalid: 'این کد تخفیف معتبر نیست یا منقضی/تمام‌شده',
    // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۵ مورد ۵
    discountCodeMinQuantityNotMet: (minQuantity: number) =>
      `این کد تخفیف فقط برای خرید حداقل ${minQuantity} عدد معتبره`,
    discountAppliedHint: 'اگه کد تخفیف داری، بگو تا برات اعمال کنم.',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — فالوآپ رضایت، چند روز بعد از تایید
    // سفارش (نه فوری مثل reviewFollowUpPrompt بالا)؛ پیام ثابت، بدون فراخوان AI
    satisfactionFollowUpPrompt:
      'چند روزی از خریدت گذشته — همه‌چیز خوب بود؟ اگه مشکلی هست همین‌جا بگو تا پیگیری کنیم 🙏',
    satisfactionThanksAck:
      'خوشحالیم که راضی بودی! هر وقت باز چیزی خواستی، همین‌جا هستیم 🌟',
    satisfactionNegativeAck:
      'بابت این تجربه متاسفیم 🙏 همین الان به فروشنده اطلاع دادیم تا پیگیری کنه.',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۴ + بخش ۵.۱۰ بند ۱ — سبد رهاشده: یادآوری
    // یک‌باره، بدون فراخوان AI (پیام ثابت)، وقتی مکالمه در CART_REVIEW/AWAITING_PAYMENT بیش از حد
    // بماند؛ اگه اسم اولین آیتم سبد در دسترس بود شخصی‌سازی می‌شود، وگرنه متن ژنریک قبلی
    abandonedCartReminder: (firstItemName?: string) =>
      firstItemName
        ? `هنوز منتظر تکمیل خرید «${firstItemName}» هستیم 🙂 اگه سوالی مونده یا نیاز به کمک داری، همین‌جا بگو.`
        : 'هنوز منتظر تکمیل خریدتیم 🙂 اگه سوالی مونده یا نیاز به کمک داری، همین‌جا بگو.',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲ — یادآوری دوم (۱۸ ساعت بعد از
    // اولی)، فقط وقتی فروشگاه از قبل یک StoreDiscountCode فعال داشته باشد
    abandonedCartReminderWithDiscount: (
      code: string,
      discountLabel: string,
      firstItemName?: string,
    ) =>
      `${firstItemName ? `«${firstItemName}» هنوز توی سبدته` : 'سبد خریدت هنوز تکمیل نشده'} 🙂 برای این‌که زودتر تمومش کنی، یه کد تخفیف ${discountLabel} داریم: ${code}`,
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ + docs/PRD-buyer-saved-addresses.md
    addressChooseSavedPrompt: 'سفارش رو برای کدوم آدرس بفرستم؟',
    addressNewOption: '🏠 آدرس جدید',
    addressAskName: 'برای ارسال سفارش، اول اسم و فامیل گیرنده رو بگو:',
    addressAskPhone: 'شماره تماس گیرنده چیه؟',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — قبلاً «کدوم شهر؟»
    // با تایپ آزاد بود؛ حالا دکمه‌ای از ۳۱ استان (ADDRESS_PROMPT/CHOOSE_PROVINCE)
    addressAskProvince: 'ارسال به کدوم استان؟ 👇',
    addressProvinceUseButtons: 'لطفاً از دکمه‌های بالا استان رو انتخاب کن 🙏',
    addressPhoneInvalid:
      'این شماره تماس درست به نظر نمی‌رسه — لطفاً دوباره بفرست (مثلاً 0912xxxxxxx)',
    addressAskFull: 'آدرس کامل (خیابان، کوچه، پلاک، واحد) رو بنویس:',
    addressAskPostal: 'کد پستی داری؟ (اختیاری — اگه نداری بنویس «ندارم»)',
    addressConfirmQuestion: 'همین آدرس درسته؟',
    addressConfirmButton: '✅ بله، درسته',
    addressEditButton: '✏️ از اول وارد کنم',
    provinceNotCoveredWarning: (province: string) =>
      `⚠️ فعلاً امکان ارسال به استان «${province}» نیست. می‌تونی استان دیگه‌ای انتخاب کنی یا منتظر تماس فروشنده بمونی.`,
    addressSavePrompt: 'این آدرس رو برای دفعات بعد ذخیره کنم؟',
    addressSaveYesButton: '✅ بله، ذخیره کن',
    addressSaveNoButton: 'فقط همین‌بار',
    addressSaved: 'ذخیره شد ✅',
    addressFlowConfused:
      'یه مشکلی پیش اومد، بیا از اول آدرس رو بگیریم — اسم و فامیل گیرنده؟',
    savedAddressSummary: (
      recipientName: string,
      province: string,
      address: string,
      lastUsedAt: Date,
    ) =>
      `${recipientName} — ${province}، ${address.slice(0, 40)}${address.length > 40 ? '…' : ''} (آخرین استفاده: ${lastUsedAt.toLocaleDateString('fa-IR')})`,
    addressFullSummary: (
      recipientName: string,
      recipientPhone: string,
      province: string,
      address: string,
      postalCode: string | null,
      shippingCostToman: number,
    ) =>
      `👤 ${recipientName}\n📞 ${recipientPhone}\n📍 ${province}، ${address}${postalCode ? `\nکد پستی: ${postalCode}` : ''}\n🚚 هزینه ارسال: ${shippingCostToman.toLocaleString('fa-IR')} تومان`,
  },
  telegram: {
    startNeedsLink:
      'سلام! برای شروع خرید از لینک مخصوص فروشگاه استفاده کنید، یا همین‌جا اسم فروشگاه مورد نظرتون رو تایپ کنید تا پیداش کنیم.',
    noActiveStore:
      'هنوز از هیچ فروشگاهی شروع نکرده‌اید — اسم فروشگاه رو تایپ کنید یا از لینک مستقیم فروشگاه استفاده کنید.',
    // docs/PRD-telegram-bot-channel.md بخش ۹.۲ — جستجوی فروشگاه با نام (بدون دیپ‌لینک)
    storeSearchResults: '🔎 این فروشگاه‌ها پیدا شدند، یکی رو انتخاب کنید:',
    storeSearchEmpty:
      'فروشگاهی با این اسم پیدا نشد. اسم دیگه‌ای امتحان کنید یا از لینک مستقیم فروشگاه استفاده کنید.',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۱ بند ۱ — قبلاً هر عکسی بیرون از
    // AWAITING_PAYMENT پیام گمراه‌کننده‌ی «سفارشی پیدا نکردم» می‌گرفت
    photoNotExpected:
      'فعلاً نمی‌تونم عکس رو ببینم 🙏 میشه با متن بگی چی می‌خوای؟',
    // فیدبک: پیام صوتی مشتری قبلاً وقتی تشخیص گفتار خالی برمی‌گشت یا خطا می‌خورد، بی‌صدا
    // return می‌شد — مشتری هیچ جوابی نمی‌گرفت و فکر می‌کرد بات اصلاً نشنیده
    voiceNotUnderstood:
      'متأسفانه پیام صوتی رو متوجه نشدم 🙏 میشه لطفاً به‌صورت متن بفرستی؟',
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۲ — منوی ثابت Reply Keyboard
    menuOrders: '📦 سفارش‌های من',
    menuCart: '🛒 سبد فعلی',
    menuIntro: 'از این دکمه‌ها هم می‌تونی استفاده کنی:',
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — اتصال تلگرام شخصی فروشنده برای اعلان‌ها
    sellerConnected: (storeName: string) =>
      `تلگرام شما به فروشگاه «${storeName}» وصل شد ✅ از این به بعد وقتی مشتری‌ای نیاز به پاسخ انسانی داشت یا رسیدی فرستاد، همین‌جا بهتون اطلاع می‌دیم.`,
    sellerConnectInvalid:
      'این لینک اتصال نامعتبر یا منقضی شده — یک لینک تازه از پنل («بیشتر» ← «اتصال تلگرام») بگیرید.',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (غنی‌سازی دوره‌ای) — یادآوری
    // هفتگی برای محصولاتی که مدت‌هاست آپدیت نشده‌اند (قیمت/موجودی رقیب ممکن است عوض شده باشد)
    enrichmentReminder: (staleCount: number, sampleNames: string) =>
      `📋 ${staleCount.toLocaleString('fa-IR')} محصول فروشگاه شما مدتی است آپدیت نشده (مثلاً: ${sampleNames}) — بد نیست یک نگاه بندازی و با «تکمیل خودکار همه‌ی محصولات ناقص» توی پنل دوباره enrich‌شون کنی، شاید قیمت بازار یا رقبا عوض شده باشه.`,
    handoffNotification: (customerText: string) =>
      `🔔 یک مشتری نیاز به پاسخ شما داره:\n\n«${customerText}»`,
    handoffReplyButton: '💬 پاسخ بده',
    receiptNotificationCaption: '🧾 رسید جدید برای بررسی رسید.',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۴ گزینه A — خط اضافه‌شده به
    // caption بالا، بر اساس خواندن خودکار مبلغ رسید با vision؛ receiptVerifiedMatch===null
    // یعنی استخراج ناموفق بود، هیچ خطی اضافه نمی‌شود (سکوت امن‌تر از حدس غلط)
    receiptAmountMatch: (amountToman: number) =>
      `✅ مبلغ رسید (${amountToman.toLocaleString('fa-IR')} تومان) با مبلغ سفارش مطابقت دارد.`,
    receiptAmountMismatch: (extractedToman: number, expectedToman: number) =>
      `⚠️ مبلغ خوانده‌شده از رسید (${extractedToman.toLocaleString('fa-IR')} تومان) با مبلغ سفارش (${expectedToman.toLocaleString('fa-IR')} تومان) یکی نیست — قبل از تایید دوباره چک کن.`,
    receiptApproveButton: '✅ تایید',
    receiptRejectButton: '❌ رد',
    orderApprovedFromTelegram: 'سفارش تایید شد ✅',
    orderRejectedFromTelegram: 'سفارش رد شد ❌',
    sellerReplyPrompt: (conversationId: string) =>
      `✍️ جواب مشتری رو تایپ کنید و بفرستید:\n(کد گفتگو: ${conversationId})`,
    sellerReplySent: 'پیام شما برای مشتری ارسال شد ✅',
    historyEmpty: 'هنوز هیچ گفتگویی نداشته‌اید.',
    historyTitle: '📜 گفتگوهای قبلی شما را انتخاب کنید:',
    historyButtonLabel: (
      storeName: string,
      productName: string | null,
      status: string,
    ) => `${storeName} — ${productName ?? 'بدون محصول'} — ${status}`,
    historyStatusLabels: {
      COMPLETED: 'تکمیل‌شده',
      REJECTED: 'ردشده',
      IN_PROGRESS: 'در حال انجام',
      NEEDS_ATTENTION: 'نیاز به پیگیری',
    } as Record<string, string>,
    historyNotFound: 'این گفتگو پیدا نشد.',
    historyTranscriptHeader: (storeName: string, status: string) =>
      `📜 گفتگو با «${storeName}» — وضعیت: ${status}\n—`,
    historyCustomerLabel: 'شما',
    historyAgentLabel: 'ربات/فروشنده',
  },
  sms: {
    otpText: (code: string) =>
      `کد تأیید دستیار AI: ${code}\nاین کد ۲ دقیقه اعتبار دارد`,
    subscriptionActivated: (planName: string, refId: string) =>
      `اشتراک ${planName} شما فعال شد. کد پیگیری: ${refId}`,
    sendFailed: 'ارسال پیامک با خطا مواجه شد. لطفاً دوباره تلاش کنید',
  },
  users: {
    notFound: 'کاربر یافت نشد',
    updated: 'پروفایل با موفقیت به‌روز شد',
    disabled: 'این حساب کاربری غیرفعال است',
  },
  feedback: {
    submitted: 'نظر شما با موفقیت ثبت شد',
    notFound: 'فیدبک یافت نشد',
    summaryNotReady: 'هنوز خلاصه‌ای در دسترس نیست',
  },
  admin: {
    forbidden: 'دسترسی فقط برای مدیران مجاز است',
    userNotFound: 'کاربر یافت نشد',
    userUpdated: 'کاربر به‌روز شد',
  },
  budget: {
    dailyExceeded: 'بودجه روزانه شما به پایان رسیده است',
    walletInsufficient: 'موجودی کیف پول برای ادامه کافی نیست',
    sessionLimit:
      'به سقف مصرف توکن امروزِ پلن شما رسیدید. برای ادامه، پلن خود را ارتقا دهید.',
  },
  upsell: {
    free: 'برای ادامه استفاده، پلن حرفه‌ای تهیه کنید',
    pro: 'برای مصرف بیشتر، پلن ویژه را امتحان کنید',
    premium: 'کیف پول خود را شارژ کنید تا بدون وقفه ادامه دهید',
  },
  wallet: {
    notFound: 'کیف پول یافت نشد',
    credited: (amount: number) =>
      `${amount.toLocaleString('fa-IR')} ریال به کیف پول شما افزوده شد`,
    insufficient: 'موجودی کیف پول کافی نیست',
  },
  ticket: {
    created: 'تیکت پشتیبانی شما با موفقیت ثبت شد',
    notFound: 'تیکت یافت نشد',
    closed: 'این تیکت بسته شده است',
    updated: 'تیکت به‌روز شد',
  },
  messageFeedback: {
    submitted: 'بازخورد شما ثبت شد',
    notFound: 'پیام یافت نشد',
    onlyAssistant: 'فقط می‌توان به پاسخ دستیار بازخورد داد',
    summaryNotReady: 'هنوز بازخورد جدیدی برای خلاصه‌سازی وجود ندارد',
  },
  waitlist: {
    limitReached:
      'سهمیه‌ی روزانه‌ی پیش‌ثبت‌نام شما تمام شد. برای پیام بیشتر و مدل‌های پیشرفته، منتظر بمانید تا ثبت‌نامتان تکمیل شود',
    invalidToken: 'لینک نامعتبر یا منقضی شده است',
    campaignNotFound: 'کمپینی یافت نشد',
    notWaiting: 'این کاربر در لیست انتظار نیست',
  },
  networkOutage: {
    alreadyOpen: 'یک قطعی از قبل ثبت شده و هنوز پایان نیافته است',
    noneOpen: 'هیچ قطعی بازی برای پایان دادن وجود ندارد',
  },
  adminNotification: {
    notFound: 'نوتیفیکیشن یافت نشد',
    paymentTitle: 'پرداخت جدید',
    paymentBody: (planName: string, amount: number, phone: string) =>
      `اشتراک ${planName} به مبلغ ${amount.toLocaleString('fa-IR')} تومان توسط ${phone} خریداری شد`,
    walletTopupTitle: 'شارژ کیف‌پول جدید',
    walletTopupBody: (amount: number, phone: string) =>
      `کیف‌پول ${phone} به مبلغ ${amount.toLocaleString('fa-IR')} تومان شارژ شد`,
    // docs/PRD-seller-credit-billing.md بخش ۷
    storeCreditTopupTitle: 'خرید اعتبار فروشگاه',
    storeCreditTopupBody: (storeName: string, amount: number, phone: string) =>
      `اعتبار AI فروشگاه «${storeName}» به مبلغ ${amount.toLocaleString('fa-IR')} تومان توسط ${phone} شارژ شد`,
    ticketTitle: 'تیکت پشتیبانی جدید',
    ticketBody: (subject: string, phone: string) =>
      `تیکت جدید از ${phone}: «${subject}»`,
    systemErrorTitle: 'مشکل سیستمی',
    systemErrorBody: (count: number, minutes: number) =>
      `${count.toLocaleString('fa-IR')} خطای سرور در ${minutes.toLocaleString('fa-IR')} دقیقه‌ی اخیر ثبت شد`,
    liaraErrorTitle: 'نرخ خطای بالای Liara AI',
    liaraErrorBody: (failRate: number, sampleSize: number, minutes: number) =>
      `${(failRate * 100).toLocaleString('fa-IR')}٪ از ${sampleSize.toLocaleString('fa-IR')} تماس به Liara AI در ${minutes.toLocaleString('fa-IR')} دقیقه‌ی اخیر ناموفق بود`,
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۶
    queueJobFailedTitle: 'شکست مکرر یک صف پردازشی',
    queueJobFailedBody: (queueName: string, count: number, minutes: number) =>
      `صف «${queueName}» در ${minutes.toLocaleString('fa-IR')} دقیقه‌ی اخیر ${count.toLocaleString('fa-IR')} بار شکست خورد`,
  },
  chatImages: {
    tooMany: (max: number) =>
      `حداکثر ${max.toLocaleString('fa-IR')} عکس در هر پیام مجاز است`,
    invalidFormat: 'فرمت عکس نامعتبر است — فقط PNG/JPEG/WEBP/GIF مجاز است',
    tooLarge: (maxMb: number) =>
      `حجم هر عکس نباید بیشتر از ${maxMb.toLocaleString('fa-IR')} مگابایت باشد`,
    contentMismatch: 'محتوای عکس با فرمت اعلام‌شده مطابقت ندارد',
    formatNotAllowed: (allowed: string) =>
      `فرمت این عکس مجاز نیست — فقط ${allowed} پذیرفته می‌شود`,
  },
  // docs/PRD-chat-files-and-pdf.md بخش ۳ — پیوست فایل غیرعکس در چت (PDF/DOCX/TXT/CSV/XLSX/کد)
  chatFiles: {
    invalidFormat:
      'فرمت این فایل پشتیبانی نمی‌شود — فقط PDF, DOCX, TXT, MD, CSV, XLSX و فایل‌های کد رایج',
    tooLarge: (maxMb: number) =>
      `حجم فایل نباید بیشتر از ${maxMb.toLocaleString('fa-IR')} مگابایت باشد`,
    contentMismatch: 'محتوای فایل با فرمت اعلام‌شده مطابقت ندارد',
    tooMany: (max: number) =>
      `حداکثر ${max.toLocaleString('fa-IR')} فایل در هر پیام مجاز است`,
    emptyExtractedText: (filename: string) =>
      `این فایل («${filename}») متنی نبود یا نتوانستیم چیزی از آن بخوانیم`,
    truncated: (filename: string) =>
      `فایل «${filename}» بزرگ بود — فقط بخش اول آن خوانده شد`,
  },
  chatMedia: {
    invalidVideo: 'فرمت ویدیو پشتیبانی نمی‌شود — فقط MP4، WEBM، MOV',
    invalidAudio: 'فرمت صدا پشتیبانی نمی‌شود — فقط MP3، WAV، M4A، OGG',
    videoTooLarge: (maxMb: number) =>
      `حجم ویدیو نباید بیشتر از ${maxMb.toLocaleString('fa-IR')} مگابایت باشد`,
    audioTooLarge: (maxMb: number) =>
      `حجم فایل صدا نباید بیشتر از ${maxMb.toLocaleString('fa-IR')} مگابایت باشد`,
    contentMismatch: 'محتوای فایل با فرمت اعلام‌شده مطابقت ندارد',
    tooManyVideos: (max: number) =>
      `حداکثر ${max.toLocaleString('fa-IR')} ویدیو در هر پیام مجاز است`,
    tooManyAudios: (max: number) =>
      `حداکثر ${max.toLocaleString('fa-IR')} فایل صدا در هر پیام مجاز است`,
    videoNotSupported:
      'این مدل ویدیو را پشتیبانی نمی‌کند. یک مدل جمینای، Qwen یا Kimi انتخاب کنید.',
    audioNotSupported:
      'این مدل ورودی صدا را پشتیبانی نمی‌کند. لطفاً مدل دیگری انتخاب کنید.',
  },
  // docs/PRD-discovery-and-credits.md — دیسکاوری (سبک‌های آماده‌ی عکس/متن) + پروژه‌ها + اعتبار «نیوو»
  discovery: {
    promptNotFound: 'این سبک یافت نشد یا دیگر فعال نیست',
    projectNotFound: 'پروژه یافت نشد',
    insufficientCredits: 'اعتبار نیوو کافی نیست — لطفاً شارژ کنید',
    generationFailed:
      'تولید ناموفق بود — اعتبار شما کسر نشد، دوباره امتحان کنید',
    userImageRequired: 'این سبک نیاز به آپلود عکس دارد',
    requestReceived: 'درخواست شما ثبت شد — تیم ما بررسی می‌کند',
    customAmountBelowMinimum: (min: number) =>
      `حداقل مقدار مجاز برای این بسته ${min.toLocaleString('fa-IR')} نیوو است`,
    anonTrialAlreadyUsed:
      'شما قبلاً از تولید رایگان مهمان استفاده کرده‌اید — برای ادامه ثبت‌نام کنید',
    extractionFailed:
      'تبدیل عکس به پرامپت ناموفق بود — اعتبار شما کسر نشد، دوباره امتحان کنید',
    invalidExtractionModel:
      'مدل انتخاب‌شده در دسترس نیست — لطفاً مدل دیگری انتخاب کنید',
    tooManyPendingExtractions:
      'شما تعداد زیادی پیشنهاد در انتظار بررسی دارید — تا زمان بررسی توسط تیم صبر کنید',
    pinnedPromptMustBeActive:
      'فقط سبک‌های تاییدشده و فعال قابل‌پین‌کردن به پروژه هستند',
  },
  credits: {
    signupBonusDescription: 'شارژ اولیه‌ی رایگان خوش‌آمدگویی',
    referralSignupRewardDescription: 'پاداش معرفی دوست (ثبت‌نام با لینک شما)',
  },
  // docs/PRD-nivo-cal.md فاز ۱ — اسکن سریع کالری از روی عکس غذا
  nivoCal: {
    insufficientCredits: 'اعتبار نیوو کافی نیست — لطفاً شارژ کنید',
    scanFailed: 'تحلیل عکس ناموفق بود — اعتبار شما کسر نشد، دوباره امتحان کنید',
    scanDebitDescription: 'اسکن کالری Nivo Cal',
    logNotFound: 'این اسکن یافت نشد',
    profileNotFound: 'هنوز پروفایل تغذیه نساختی',
    profileAlreadyExists:
      'پروفایل تغذیه‌ات قبلاً ساخته شده — می‌تونی ویرایشش کنی',
  },
  captionStudio: {
    projectNotFound: 'این پروژه یافت نشد',
    invalidVideoFormat: 'فرمت ویدیو پشتیبانی نمی‌شود (فقط MP4/MOV)',
    fileTooLarge: 'حجم فایل بیشتر از حد مجاز است',
    noFileUploaded: 'فایلی ارسال نشده',
    onlyFailedCanRetry: 'فقط پروژه‌ی ناموفق قابل‌تلاش‌مجدد است',
    notReadyForRender: 'این پروژه هنوز آماده‌ی رندر نیست',
    insufficientCredits: 'اعتبار نیوو کافی نیست — لطفاً شارژ کنید',
    renderDebitDescription: 'رندر زیرنویس ویدیو',
    videoReadyPushTitle: 'ویدیوی زیرنویس‌دار شما آماده شد',
    videoReadyPushBody: 'ویدیوی شما با زیرنویس آماده‌ی دانلود است',
    renderFailedPushTitle: 'رندر زیرنویس ناموفق بود',
    renderFailedPushBody: 'رندر زیرنویس ناموفق بود — اعتبار شما کسر نشد',
    sourceAlreadyDeleted: 'ویدیوی اصلی حذف شده — امکان رندر یا تلاش مجدد نیست',
  },
  videoEdit: {
    modelNotFound: 'این مدل یافت نشد یا دیگر فعال نیست',
    modelDisabled: 'این مدل دیگر فعال نیست',
    featureDisabled: 'ویرایش ویدیو فعلاً غیرفعال است',
    jobNotFound: 'این درخواست یافت نشد',
    sessionNotFound: 'این جلسه یافت نشد',
    // مبلغ لازم/موجود واقعی توی پیام نشان داده می‌شود، نه فقط «کافی نیست» — با واحد «نیوو»
    // (همون واحد نمایشی-به-کاربر CreditsService)، نه تومان خام؛ دستور صریح کاربر. video-edit.service.ts
    // createJob هم amounts خام را در بدنه‌ی خطا (neededCredits/balanceCredits) برمی‌گرداند
    insufficientCredits: (neededCredits: number, balanceCredits: number) =>
      `برای این کار حدود ${neededCredits.toLocaleString('fa-IR')} نیوو لازم است؛ موجودی فعلی شما ${balanceCredits.toLocaleString('fa-IR')} نیوو است. لطفاً کیف‌پول خود را شارژ کنید.`,
    insufficientMinBalance: (neededCredits: number, balanceCredits: number) =>
      `برای ساخت ویدیو حداقل ${neededCredits.toLocaleString('fa-IR')} نیوو لازم است؛ موجودی فعلی شما ${balanceCredits.toLocaleString('fa-IR')} نیوو است. لطفاً کیف‌پول خود را شارژ کنید.`,
    tooManyConcurrentJobs:
      'شما چند ویدیوی دیگر در صف دارید — صبر کنید تا تمام شوند',
    dailyLimitReached: 'به سقف روزانه‌ی این فیچر رسیده‌اید',
    videoRequiredForEdit: 'برای ادیت باید یک ویدیو آپلود کنید',
    imagesNotSupportedForEdit: 'این مدل در حالت ادیت عکس نمی‌پذیرد',
    videoNotSupportedByModel: 'این مدل ویدیوی مرجع/منبع نمی‌پذیرد',
    editModeNotSupportedByModel:
      'این مدل فقط از حالت «تولید با رفرنس» پشتیبانی می‌کند، نه ویرایش صحنه‌حفظ‌کننده',
    resolutionNotSupportedByModel: (allowed: string[]) =>
      `این رزولوشن برای این مدل پشتیبانی نمی‌شود — گزینه‌های مجاز: ${allowed.join('، ')}`,
    // OpenRouter+Seedance: وقتی پرامپت شبیه دستور «ویرایش» باشد («فقط X را عوض کن»)، خودِ مدل
    // این کار را video-editing تشخیص می‌دهد و duration=-1 می‌خواهد — چیزی که از مسیر OpenRouter
    // اصلاً قابل‌ارسال نیست (تحقیق ۱۴۰۵/۰۶/۱۷: هم gateway هم passthrough رد می‌کنند). راه‌حل
    // سمت کاربر: پرامپت را «تولیدی‌تر» بنویسد (مثلاً «با الهام از این ویدیو یه صحنه‌ی جدید بساز»)
    openRouterEditPromptRejected:
      'این پرامپت شبیه یه دستور «فقط این بخش رو عوض کن» است — این مدل چنین حالتی رو از این مسیر پشتیبانی نمی‌کنه. سعی کن پرامپت رو به شکل «یه ویدیوی تازه با الهام از این رفرنس بساز» بنویسی.',
    imagesNotSupportedByModel: 'این مدل عکس مرجع نمی‌پذیرد',
    tooManyImages: (max: number) => `این مدل حداکثر ${max} عکس می‌پذیرد`,
    videoWindowRequired: 'باید بازه‌ی زمانی ویدیو (شروع/پایان) را مشخص کنید',
    videoWindowTooWide: (max: number) =>
      `پهنای بازه‌ی انتخابی نباید بیشتر از ${max} ثانیه باشد`,
    videoTooLong: (max: number) =>
      `این ویدیو طولانی‌تر از حداکثر مجاز (${max} ثانیه) است`,
    invalidVideoFormat: 'فرمت ویدیو پشتیبانی نمی‌شود (فقط MP4/MOV)',
    videoTranscodeFailed:
      'این ویدیو قابل تبدیل نبود. یک فایل MP4 معمولی بفرست، نه حالت سینمایی خراب یا فایل ناقص.',
    noFileUploaded: 'فایلی ارسال نشده',
    jobReadyPushTitle: 'ویدیوی شما آماده شد',
    jobReadyPushBody: 'ویدیوی شما آماده‌ی دانلود است',
    jobFailedPushTitle: 'پردازش ویدیو ناموفق بود',
    jobFailedPushBody: 'پردازش ویدیوی شما ناموفق بود — اعتبار شما کسر نشد',
    promptReviewFailed: 'بررسی پرامپت الان جواب نداد، دوباره امتحان کن',
  },
  // docs/PRD-marketplace-explore-cross-store.md بخش ۷ (فاز ۵ MVP) — «سفارش‌های من،
  // همه‌ی فروشگاه‌ها»؛ پیام‌های OTP خودِ fa.auth عمداً دوباره استفاده می‌شوند (همون معنا)
  marketplace: {
    invalidSession: 'نشست شما منقضی شده — دوباره شماره‌ات رو تأیید کن',
    noOrdersFound: 'هنوز سفارشی با این شماره ثبت نشده',
  },
} as const;
