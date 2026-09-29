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
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: { id: number };
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}
