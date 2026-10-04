// فقط زیرمجموعه‌ای از Telegram Bot API که واقعاً استفاده می‌شود — بدون بسته‌ی تایپ جدا
// (docs/PRD-telegram-bot-channel.md بخش ۴)
export interface TelegramChat {
  id: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

// docs/PRD-bulk-product-import-from-document.md — فایل PDF/Word که فروشنده از چت شخصی‌اش
// می‌فرستد تا چند محصول را با هم اضافه/آپدیت کند
export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

// docs/PRD-seller-telegram-management-bot.md — دکمه‌ی «اشتراک‌گذاری شماره» (request_contact)
// شماره‌ی تلفن متصل به همان اکانت تلگرام کاربر را برمی‌گرداند؛ phone_number از قالب ایران
// بدون نرمال‌سازی می‌آید (normalizePhone خودش این را هندل می‌کند)
export interface TelegramContact {
  phone_number: string;
  user_id?: number;
}

export interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  document?: TelegramDocument;
  contact?: TelegramContact;
  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — force_reply: وقتی فروشنده به پیام
  // force_reply بات جواب می‌دهد، تلگرام این فیلد را با همان پیام اصلی پر می‌کند؛ conversationId
  // از متن همان پیام اصلی (که ما ساختیم) استخراج می‌شود، نیازی به session state جدا نیست
  reply_to_message?: TelegramMessage;
  // docs/PRD-sales-agent-voice.md بخش ۶.۴ — تنها سیگنال در دسترس برای تخمین جنسیت خریدار
  from?: { id: number; first_name?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: { id: number; first_name?: string };
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۲ — Reply Keyboard واقعی تلگرام (جای کیبرد
// خود گوشی می‌نشیند، با اسکرول چت از بین نمی‌رود)، برخلاف TelegramInlineKeyboard که زیر یک
// پیام خاص می‌چسبد و با تایپ دکمه، متن روی دکمه (نه یک callback_data مخفی) برمی‌گردد — پس فقط
// برای چند اکشن کلی/ثابت مناسب است، نه نتایج دینامیک (مثل نتایج سرچ فروشگاه)
export interface TelegramReplyKeyboard {
  // request_contact: دکمه‌ای که با لمس، شماره‌ی تلفن متصل به اکانت تلگرام کاربر را به‌عنوان
  // یک پیام contact می‌فرستد — docs/PRD-seller-telegram-management-bot.md
  keyboard: { text: string; request_contact?: boolean }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export type TelegramKeyboard = TelegramInlineKeyboard | TelegramReplyKeyboard;
