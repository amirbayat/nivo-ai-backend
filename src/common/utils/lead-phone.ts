import { toEnglishDigits } from './normalize-digits';

// docs/PRD-nivo-lead-shop-seller-signup.md §5.2 — ارقام فارسی/عربی، +98/0098/98 → 0؛ نامعتبر = null
export function normalizeLeadPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = toEnglishDigits(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (/^98\d{10}$/.test(s)) s = '0' + s.slice(2);
  if (/^9\d{9}$/.test(s)) s = '0' + s;
  return /^09\d{9}$/.test(s) ? s : null;
}

// اگر کاربر شماره را داخل متن پیامش نوشته باشد (قبل از نرمال‌سازی)، اولین شماره‌ی موبایل معتبر
export function extractLeadPhone(text: string): string | null {
  const match = toEnglishDigits(text).match(/(?:\+98|0098|98|0)?[\s-]?9(?:[\s-]?\d){9}/);
  return match ? normalizeLeadPhone(match[0]) : null;
}
