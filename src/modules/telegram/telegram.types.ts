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

export interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — force_reply: وقتی فروشنده به پیام
  // force_reply بات جواب می‌دهد، تلگرام این فیلد را با همان پیام اصلی پر می‌کند؛ conversationId
  // از متن همان پیام اصلی (که ما ساختیم) استخراج می‌شود، نیازی به session state جدا نیست
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: { id: number };
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
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
}

export type TelegramKeyboard = TelegramInlineKeyboard | TelegramReplyKeyboard;
