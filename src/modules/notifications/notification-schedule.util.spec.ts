import { smsQuietDelayMs, tehranHour } from './notification-schedule.util';

// تهران = UTC+03:30 ثابت (بدون ساعت تابستانی)
const at = (utc: string) => new Date(utc);

describe('SMS quiet hours [3.6 / D-5]', () => {
  it('ساعت تهران', () => {
    expect(tehranHour(at('2026-10-13T06:30:00Z'))).toBe(10);
    expect(tehranHour(at('2026-10-13T19:00:00Z'))).toBe(22);
  });

  it('وسط روز → بدون تاخیر', () => {
    expect(smsQuietDelayMs(at('2026-10-13T08:30:00Z'))).toBe(0); // ۱۲:۰۰
  });

  it('۲۳:۰۰ تهران → تا ۰۸:۰۰ فردا (۹ ساعت)', () => {
    const d = smsQuietDelayMs(at('2026-10-13T19:30:00Z')); // ۲۳:۰۰
    expect(d).toBe(9 * 3600 * 1000);
  });

  it('۰۳:۰۰ تهران → تا ۰۸:۰۰ همان روز (۵ ساعت)', () => {
    const d = smsQuietDelayMs(at('2026-10-13T23:30:00Z')); // ۰۳:۰۰ (۱۴ اکتبر)
    expect(d).toBe(5 * 3600 * 1000);
  });

  it('دقیقاً ۰۸:۰۰ → ارسال؛ دقیقاً ۲۲:۰۰ → سکوت', () => {
    expect(smsQuietDelayMs(at('2026-10-13T04:30:00Z'))).toBe(0); // ۰۸:۰۰
    expect(smsQuietDelayMs(at('2026-10-13T18:30:00Z'))).toBe(10 * 3600 * 1000); // ۲۲:۰۰
  });
});
