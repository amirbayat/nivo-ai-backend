// PRD-nivo-sales-unified.md بند ۰.۱ (۶) — همه‌ی مهلت‌ها و سقف‌های عملیات فروش (سفارش، رسید،
// بازپرداخت، اعتبار، …) فقط اینجا تعریف می‌شوند، نه به‌صورت عدد جادویی داخل سرویس‌ها.
// هر تسک بعدی مقدار مورد نیازش را همین‌جا اضافه می‌کند. واحد زمان در نام هر ثابت آمده است.
// «امروز/روز/ساعت کاری» همیشه با Asia/Tehran محاسبه می‌شود (تصمیم D-5).
export const SALES_OPS_TIMEZONE = 'Asia/Tehran';

// 0.10 — سقف ساخت مکالمه‌ی جدید (chat/start، هر کدام Customer + مکالمه + احتمالاً call LLM می‌سازد)
export const CHAT_START_LIMIT_PER_IP_PER_MIN = 10;
export const CHAT_START_LIMIT_PER_STORE_PER_MIN = 300;

// 0.2 — سقف تعداد هر خط سبد؛ qty باید عدد صحیح بین ۱ و این سقف باشد
export const CART_MAX_QTY_PER_LINE = 50;

// 0.4 — قفل per-conversation (Redis) و صف پیام‌های رسیده در حین پردازش
export const CONVERSATION_LOCK_TTL_MS = 60_000;
// اکشن‌های قطعی (دکمه‌ی سبد/پرداخت/رسید) تا این مدت برای آزاد شدن قفل صبر می‌کنند
export const CONVERSATION_LOCK_ACTION_WAIT_MS = 5_000;
export const CONVERSATION_LOCK_RETRY_INTERVAL_MS = 100;
// سقف پیام‌های صف‌شده (جلوی سیل پیام؛ قدیمی‌ترین‌ها دور ریخته می‌شوند)
export const CONVERSATION_PENDING_MAX_MESSAGES = 20;
// سقف دورهای drain پشت‌سرهم در یک نگه‌داری قفل
export const CONVERSATION_DRAIN_MAX_ROUNDS = 5;

// 0.5 — وب‌هوک تلگرام/اینستاگرام: dedupe روی شناسه‌ی رویداد و همزمانی پردازشگر صف
export const WEBHOOK_DEDUPE_TTL_SECONDS = 86_400;
export const TELEGRAM_UPDATES_QUEUE_CONCURRENCY = 10;

// 0.6 — تعداد رویداد مکالمه در هر صفحه (جدیدترین‌ها؛ «قدیمی‌تر» با cursor)
export const CONVERSATION_EVENTS_PAGE_SIZE = 50;

// 0.7 — سفارش‌های «موفق» برای همه‌ی آمار درآمد/اثبات اجتماعی؛ با «ارسال» سفارش از آمار نمی‌افتد
// 3.15 — DELIVERED هم موفق است (فاز ۳)
export const SUCCESSFUL_ORDER_STATUSES = [
  'APPROVED',
  'SHIPPED',
  'DELIVERED',
] as const;

// 2.1 — سقف زمان و هم‌زمانی call های LLM در یک turn موتور فروش
// هر HTTP call به مدل حداکثر این مدت؛ کل turn (همه‌ی stepها، retry اصلاحی و fallback) حداکثر
// TURN_DEADLINE؛ بعد از آن هر call بلافاصله fail می‌شود و turn با پاسخ degraded تمام می‌شود
export const LLM_CALL_TIMEOUT_MS = 20_000;
export const LLM_TURN_DEADLINE_MS = 45_000;
export const LLM_MAX_RETRIES = 1;
// مدل A/B → defaultModel → حداکثر این تعداد مدل از زنجیره‌ی fallback (نه ۷ تا)
export const LLM_FALLBACK_MAX_MODELS = 2;
// سقف call های هم‌زمان LLM در هر پاد؛ بالاتر از آن در صف می‌ماند و اگر صف هم بلند شد
// «شلوغ است» برمی‌گردد
export const LLM_GLOBAL_CONCURRENCY = 100;
export const LLM_QUEUE_MAX_WAITING = 200;

// 2.1 — Idempotency-Key پیام (clientMessageId): ارسال مجدد همان پیام جواب ذخیره‌شده را برمی‌گرداند
export const MESSAGE_IDEMPOTENCY_TTL_SECONDS = 300;
export const MESSAGE_IDEMPOTENCY_PENDING_TTL_SECONDS = 120;

// 1.2 — برآورد هزینه‌ی یک turn میانگین (تومان، بعد از ضریب). هر turn در حال اجرا این مقدار از
// موجودی قابل‌خرج «رزرو» می‌کند تا ده مکالمه‌ی هم‌زمان یک فروشگاه با موجودی صفر، هر کدام
// جداگانه از چک عبور نکنند. TODO(product): بعد از چند هفته با داده‌ی واقعی تنظیم شود.
export const TURN_COST_ESTIMATE_TOMAN = 1_700;
// کف overdraft اعتبار فروشگاه: مکالمات باز تا این مقدار «زیر صفر» می‌توانند خرج کنند
// (هزینه‌ی واقعی بعد از فراخوان معلوم می‌شود)؛ زیر آن، turn بعدی handoff «فروشنده شخصاً جواب
// می‌دهد» می‌شود. ≈ هزینه‌ی ۳ turn میانگین.
export const OVERDRAFT_FLOOR_TOMAN = 3 * TURN_COST_ESTIMATE_TOMAN;
// رزرو یک turn در Redis بعد از این مدت خودکار منقضی می‌شود (turn کرش‌کرده نباید برای همیشه رزرو بماند)
export const TURN_RESERVATION_TTL_SECONDS = 90;
// کش Redis موجودی قابل‌خرج (store:bal:{id}) برای canSpend
export const STORE_BALANCE_CACHE_TTL_SECONDS = 30;
// 1.5 — هشدار «اعتبارت رو به اتمامه» وقتی موجودی ≤ این نسبت از آخرین شارژ شد؛ هر کدام حداکثر
// روزی یک‌بار به‌ازای فروشگاه
export const CREDIT_LOW_WARNING_RATIO = 0.2;
export const CREDIT_ALERT_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

// 3.10 — مهلت پرداخت سفارش: createdAt + ۲۴ ساعت؛ یادآوری خریدار بعد از ۲ ساعت؛ cron هر ۱۰ دقیقه
export const ORDER_PAYMENT_WINDOW_HOURS = 24;
export const ORDER_PAYMENT_REMINDER_AFTER_HOURS = 2;
export const ORDER_EXPIRY_CRON = '*/10 * * * *';
// سفارش‌های پرداخت‌نشده‌ای که از این قدیمی‌ترند بی‌صدا لغو می‌شوند (backfill؛ بدون پیام به خریدار)
export const ORDER_EXPIRY_SILENT_AFTER_DAYS = 3;
// هر پاس cron حداکثر این تعداد سفارش را پردازش می‌کند (دسته‌ای)
export const ORDER_EXPIRY_BATCH_SIZE = 200;

// 3.6 — قوانین ثابت NotificationService
export const NOTIFICATION_DEDUPE_TTL_SECONDS = 600;
export const NOTIFICATION_SMS_DAILY_CAP_PER_BUYER = 5;
// ساعت سکوت پیامک (Asia/Tehran): از QUIET_START تا QUIET_END صبح روز بعد صف می‌شود
export const NOTIFICATION_SMS_QUIET_START_HOUR = 22;
export const NOTIFICATION_SMS_QUIET_END_HOUR = 8;
export const NOTIFICATION_JOB_ATTEMPTS = 3;
// TODO(product): هزینه‌ی واقعی هر پیامک از واحد مالی؛ تا آن موقع در NotificationLog صفر ثبت می‌شود
export const NOTIFICATION_SMS_COST_TOMAN = 0;

// 3.5 — شرکت‌های حمل (لیست ثابت)
// 3.9 — receipt vision. One cheap model, one fallback, no full fallback chain.
export const RECEIPT_CHECK_TIMEOUT_MS = 15_000;
export const RECEIPT_CHECK_MAX_IMAGES = 3;
export const RECEIPT_CHECK_MAX_EDGE_PX = 1024;
export const RECEIPT_CHECK_JPEG_QUALITY = 80;
export const RECEIPT_CHECK_MAX_OUTPUT_TOKENS = 200;
export const RECEIPT_CHECK_BUDGET_USD = 0.002;
export const RECEIPT_VISION_FALLBACK_MODEL = 'google/gemini-3-flash-preview';

// 3.12 — receipt sitting in RECEIPT_SUBMITTED for 3 Tehran business hours (08–22).
export const RECEIPT_SLA_BUSINESS_HOURS = 3;
export const RECEIPT_SLA_DAY_START_HOUR = 8;
export const RECEIPT_SLA_DAY_END_HOUR = 22;
export const RECEIPT_SLA_MIN_SAMPLES = 5;
export const RECEIPT_SLA_LOOKBACK_DAYS = 30;

// 3.11 — buyer destination reminder, seller overdue, purge of the full number.
export const REFUND_DESTINATION_REMINDER_HOURS = 24;
export const REFUND_OVERDUE_HOURS = 48;
export const REFUND_NUDGE_COOLDOWN_HOURS = 24;
export const REFUND_DESTINATION_PURGE_AFTER_DAYS = 30;

// 4.13 — signed order link. The SMS carries only the short code.
export const ORDER_LINK_TTL_DAYS = 14;
export const ORDER_LINK_CODE_LENGTH = 8;
export const ORDER_LINK_RATE_PER_MINUTE = 30;

// 3.15 — ask the buyer once, 3 days after ship, if they have not confirmed delivery.
export const DELIVERY_CONFIRM_AFTER_DAYS = 3;

// One cron for receipt SLA, refund reminders, delivery nudge, and destination purge.
export const ORDER_OPS_CRON = '*/15 * * * *';

export const ORDER_CARRIERS = [
  'پست پیشتاز',
  'تیپاکس',
  'چاپار',
  'پیک',
  'سایر',
] as const;
