// [QA-3] فیلدهای حساس Store که هرگز نباید در پاسخ API فروشنده برگردند:
// توکن اینستاگرام و توکن‌های یک‌بارمصرف اتصال تلگرام/بات فروشنده.
// فرانت فقط به وجود اتصال نیاز دارد (instagramConnectedAt / instagramBusinessId / ownerTelegramChatId).
export const STORE_SENSITIVE_FIELDS = [
  'instagramAccessToken',
  'telegramConnectToken',
  'telegramConnectTokenExpiresAt',
  'sellerBotConnectToken',
  'sellerBotConnectTokenExpiresAt',
] as const;

export type StoreSensitiveField = (typeof STORE_SENSITIVE_FIELDS)[number];

export function omitStoreSecrets<T extends object>(
  store: T,
): Omit<T, StoreSensitiveField> {
  const copy = { ...store } as Record<string, unknown>;
  for (const f of STORE_SENSITIVE_FIELDS) delete copy[f];
  return copy as Omit<T, StoreSensitiveField>;
}
