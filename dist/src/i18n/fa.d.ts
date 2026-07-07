export declare const fa: {
    readonly validation: {
        readonly phoneInvalid: "شماره موبایل معتبر نیست";
        readonly otpLength: "کد تأیید باید ۶ رقم باشد";
        readonly otpDigitsOnly: "کد تأیید باید فقط عدد باشد";
        readonly required: "این فیلد الزامی است";
        readonly stringTooLong: "متن وارد شده بیش از حد مجاز است";
        readonly mustBeNumber: "مقدار باید عدد صحیح باشد";
        readonly numberPositive: "مقدار باید صفر یا بیشتر باشد";
        readonly mustBeArray: "مقدار باید آرایه باشد";
        readonly mustBeBoolean: "مقدار باید درست یا غلط باشد";
    };
    readonly auth: {
        readonly otpSent: "کد تأیید ارسال شد";
        readonly otpExpired: "کد تأیید منقضی شده است";
        readonly otpInvalid: "کد تأیید اشتباه است";
        readonly otpTooManyRequests: "تعداد درخواست بیش از حد مجاز است. لطفاً ۱۰ دقیقه صبر کنید";
        readonly otpTooManyAttempts: "تعداد تلاش‌های ناموفق زیاد است. لطفاً ۳۰ دقیقه صبر کنید";
        readonly unauthorized: "دسترسی غیرمجاز";
        readonly tokenExpired: "نشست شما منقضی شده است";
        readonly refreshTokenInvalid: "توکن نامعتبر است";
        readonly userDisabled: "حساب کاربری شما غیرفعال شده است";
    };
    readonly conversations: {
        readonly notFound: "مکالمه یافت نشد";
        readonly forbidden: "دسترسی به این مکالمه مجاز نیست";
        readonly updated: "مکالمه به‌روز شد";
        readonly deleted: "مکالمه حذف شد";
    };
    readonly chat: {
        readonly quotaExceeded: "سهمیه توکن روزانه شما تمام شده است. پلن خود را ارتقا دهید";
        readonly monthlyQuotaExceeded: "سهمیه ماهانه شما تمام شده است";
        readonly modelNotAllowed: "این مدل در پلن فعلی شما در دسترس نیست";
        readonly streamError: "خطا در دریافت پاسخ. دوباره تلاش کنید";
        readonly conversationNotFound: "مکالمه یافت نشد";
        readonly inputTooLong: (limit: number) => string;
        readonly budgetExceeded: "بودجه روزانه شما به پایان رسیده است";
        readonly walletInsufficient: "موجودی کیف پول برای ادامه کافی نیست";
        readonly dailyMessageLimitExceeded: "به سقف پیام روزانه رسیدید";
        readonly dailyBlocked: "امروز به محدودیت کامل رسیدید. فردا دوباره می‌توانید ارسال کنید";
        readonly throttledNotice: "پیام‌های باقی‌مانده امروز با محدودیت توکن ارسال می‌شوند";
    };
    readonly payment: {
        readonly pending: "در انتظار پرداخت";
        readonly success: "پرداخت موفق بود";
        readonly failed: "پرداخت ناموفق بود. در صورت کسر وجه، تا ۷۲ ساعت برگشت می‌خورد";
        readonly alreadyVerified: "این پرداخت قبلاً تأیید شده است";
        readonly notFound: "پرداخت یافت نشد";
        readonly invalidStatus: "وضعیت پرداخت نامعتبر است";
        readonly description: (planName: string) => string;
        readonly gatewayError: "خطا در اتصال به درگاه پرداخت";
    };
    readonly subscription: {
        readonly activated: "اشتراک شما فعال شد";
        readonly alreadyActive: "شما از قبل اشتراک فعال دارید";
        readonly cancelled: "اشتراک در پایان دوره لغو خواهد شد";
        readonly expired: "اشتراک شما منقضی شده است";
        readonly notFound: "اشتراک فعالی یافت نشد";
    };
    readonly plans: {
        readonly notFound: "پلن یافت نشد";
        readonly notActive: "این پلن در حال حاضر قابل خرید نیست";
        readonly created: "پلن با موفقیت ایجاد شد";
        readonly updated: "پلن با موفقیت به‌روز شد";
        readonly deleted: "پلن با موفقیت حذف شد";
    };
    readonly errors: {
        readonly notFound: "مورد درخواستی یافت نشد";
        readonly forbidden: "دسترسی مجاز نیست";
        readonly validation: "اطلاعات وارد شده معتبر نیست";
        readonly internal: "خطای داخلی سرور. لطفاً دوباره تلاش کنید";
        readonly tooManyRequests: "تعداد درخواست‌ها بیش از حد مجاز است";
    };
    readonly sms: {
        readonly otpText: (code: string) => string;
        readonly subscriptionActivated: (planName: string, refId: string) => string;
        readonly sendFailed: "ارسال پیامک با خطا مواجه شد. لطفاً دوباره تلاش کنید";
    };
    readonly users: {
        readonly notFound: "کاربر یافت نشد";
        readonly updated: "پروفایل با موفقیت به‌روز شد";
        readonly disabled: "این حساب کاربری غیرفعال است";
    };
    readonly feedback: {
        readonly submitted: "نظر شما با موفقیت ثبت شد";
        readonly notFound: "فیدبک یافت نشد";
        readonly summaryNotReady: "هنوز خلاصه‌ای در دسترس نیست";
    };
    readonly admin: {
        readonly forbidden: "دسترسی فقط برای مدیران مجاز است";
        readonly userNotFound: "کاربر یافت نشد";
        readonly userUpdated: "کاربر به‌روز شد";
    };
    readonly budget: {
        readonly dailyExceeded: "بودجه روزانه شما به پایان رسیده است";
        readonly walletInsufficient: "موجودی کیف پول برای ادامه کافی نیست";
        readonly sessionLimit: "مصرف امروز به حد بحرانی رسیده — تنها مدل پایه در دسترس است";
    };
    readonly upsell: {
        readonly free: "برای ادامه استفاده، پلن حرفه‌ای تهیه کنید";
        readonly pro: "برای مصرف بیشتر، پلن ویژه را امتحان کنید";
        readonly premium: "کیف پول خود را شارژ کنید تا بدون وقفه ادامه دهید";
    };
    readonly wallet: {
        readonly notFound: "کیف پول یافت نشد";
        readonly credited: (amount: number) => string;
        readonly insufficient: "موجودی کیف پول کافی نیست";
    };
    readonly ticket: {
        readonly created: "تیکت پشتیبانی شما با موفقیت ثبت شد";
        readonly notFound: "تیکت یافت نشد";
        readonly closed: "این تیکت بسته شده است";
        readonly updated: "تیکت به‌روز شد";
    };
    readonly messageFeedback: {
        readonly submitted: "بازخورد شما ثبت شد";
        readonly notFound: "پیام یافت نشد";
        readonly onlyAssistant: "فقط می‌توان به پاسخ دستیار بازخورد داد";
        readonly summaryNotReady: "هنوز بازخورد جدیدی برای خلاصه‌سازی وجود ندارد";
    };
    readonly waitlist: {
        readonly limitReached: "سهمیه‌ی روزانه‌ی پیش‌ثبت‌نام شما تمام شد. برای پیام بیشتر و مدل‌های پیشرفته، منتظر بمانید تا ثبت‌نامتان تکمیل شود";
        readonly invalidToken: "لینک نامعتبر یا منقضی شده است";
        readonly campaignNotFound: "کمپینی یافت نشد";
        readonly notWaiting: "این کاربر در لیست انتظار نیست";
    };
};
