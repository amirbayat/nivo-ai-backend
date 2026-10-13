import { Transform } from 'class-transformer';
import { toEnglishDigits } from '../utils/normalize-digits';

// PRD-nivo-sales-unified.md تسک 0.14 — کیبورد فارسی iOS/macOS/اندروید ارقام ۰–۹ می‌فرستد؛
// `@IsInt`/`@IsNumber`/`\d` فقط ASCII را می‌پذیرند. این دکتورها «تور ایمنی» بک‌اند هستند (فرانت
// هم با DigitsInput نرمال می‌کند). متن آزاد (توضیح محصول، پیام چت) هرگز با این‌ها تغییر نمی‌کند.

// رشته‌ی شماره/کد/OTP/کارت/شبا/کد پستی: ارقام فارسی/عربی → انگلیسی + trim
export function EnDigits(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? toEnglishDigits(value).trim() : value,
  );
}

// عدد (قیمت/موجودی/تعداد): ارقام → انگلیسی، حذف جداکننده‌ی هزارگان و «تومان»، سپس Number.
// مقدار خالی/نامعتبر دست نمی‌خورد تا IsNumber/IsInt خطای فارسی خودش را بدهد. آرایه‌ی اعداد
// عضو‌به‌عضو. نکته: اگر فیلد @Type(() => Number) هم داشته باشد class-transformer قبل از ما
// `Number('۱۲')` = NaN ساخته؛ پس همیشه از مقدار «خام» ورودی (obj[key]) می‌خوانیم.
function parseOne(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const cleaned = toEnglishDigits(value)
    .replace(/٫/g, '.')
    .replace(/[,٬،\s]/g, '')
    .replace(/تومان/g, '');
  if (cleaned === '') return value;
  const n = Number(cleaned);
  return Number.isNaN(n) ? value : n;
}

export function ToNumber(): PropertyDecorator {
  return Transform(({ value, obj, key }) => {
    const raw = (obj as Record<string, unknown> | undefined)?.[key] ?? value;
    if (Array.isArray(raw)) return raw.map(parseOne);
    return parseOne(raw);
  });
}
