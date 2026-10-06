// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳ — فقط برای REGION=INTL (ایمیل+کد،
// صفحات دایرکت هوشمند)؛ بر خلاف fa.ts کامل نیست، فقط رشته‌های همین مسیر — بقیه‌ی i18n انگلیسی
// محصول کامل در docs/PRD-domain-migration-bilingual-meta-readiness.md فاز بعد است
export const en = {
  validation: {
    emailInvalid: 'Please enter a valid email address',
    codeLength: 'The verification code must be 6 digits',
    codeDigitsOnly: 'The verification code must contain only digits',
    required: 'This field is required',
    stringTooLong: 'This text is too long',
  },
  auth: {
    emailOtpSubject: 'Your Nivo AI verification code',
    emailOtpBody: (code: string) =>
      `Your verification code is: ${code}\n\nThis code expires in a few minutes. If you didn't request this, you can ignore this email.`,
    emailSendFailed: 'Could not send the verification email. Please try again.',
    codeSent: 'Verification code sent',
    codeExpired: 'This verification code has expired',
    codeInvalid: 'Incorrect verification code',
    codeTooManyRequests: (minutes: number) =>
      `Too many requests. Please wait ${minutes} minute(s) and try again.`,
    codeTooManyAttempts: (minutes: number) =>
      `Too many failed attempts. Please wait ${minutes} minute(s) and try again.`,
    unauthorized: 'Unauthorized',
    refreshTokenInvalid: 'Invalid session, please sign in again',
    userDisabled: 'This account has been disabled',
  },
};
