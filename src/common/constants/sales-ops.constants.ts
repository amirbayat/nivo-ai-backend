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
