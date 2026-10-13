import {
  NOTIFICATION_SMS_QUIET_END_HOUR,
  NOTIFICATION_SMS_QUIET_START_HOUR,
} from '../../common/constants/sales-ops.constants';
import { startOfTehranDay, addTehranDays } from '../../common/utils/tehran-time.util';

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ساعت محلی تهران (۰..۲۳)
export function tehranHour(now: Date = new Date()): number {
  return new Date(now.getTime() + TEHRAN_OFFSET_MS).getUTCHours();
}

// 3.6 — پیامک بین ۲۲:۰۰ و ۰۸:۰۰ تهران ارسال نمی‌شود؛ تاخیر (ms) تا ۰۸:۰۰ صبح، یا ۰ اگر
// خارج از ساعت سکوت است. (D-5: همه‌ی محاسبات با Asia/Tehran)
export function smsQuietDelayMs(now: Date = new Date()): number {
  const hour = tehranHour(now);
  const inQuiet =
    hour >= NOTIFICATION_SMS_QUIET_START_HOUR ||
    hour < NOTIFICATION_SMS_QUIET_END_HOUR;
  if (!inQuiet) return 0;
  const dayStart = startOfTehranDay(now);
  const morning =
    hour >= NOTIFICATION_SMS_QUIET_START_HOUR
      ? addTehranDays(dayStart, 1).getTime() +
        NOTIFICATION_SMS_QUIET_END_HOUR * HOUR_MS
      : dayStart.getTime() + NOTIFICATION_SMS_QUIET_END_HOUR * HOUR_MS;
  return Math.max(0, morning - now.getTime());
}
