// تصمیم D-5 — هر محاسبه‌ی «امروز/روز» با Asia/Tehran. ایران از ۱۴۰۱ ساعت تابستانی ندارد
// (آفست ثابت +۰۳:۳۰)، پس برای بازه‌ی سفارش‌های اخیر آفست ثابت دقیق است و به کتابخانه نیاز نیست.
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfTehranDay(date: Date = new Date()): Date {
  const local = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TEHRAN_OFFSET_MS);
}

export function addTehranDays(dayStart: Date, days: number): Date {
  return new Date(dayStart.getTime() + days * DAY_MS);
}

// YYYY-MM-DD میلادی برای همان روز تهران
export function tehranDateString(dayStart: Date): string {
  return new Date(dayStart.getTime() + TEHRAN_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}
