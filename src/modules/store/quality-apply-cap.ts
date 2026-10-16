import { HttpException, HttpStatus } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';

// REV-4 — هر «جواب بده تا اضافه‌اش کنم» یک call مدل است؛ سقف روزانه‌ی مشترک محصول و فروشگاه.
// خطای Redis → اجازه (fail-open مثل سقف‌های بررسی)
export const QUALITY_APPLY_DAILY_CAP = 40;

export async function assertQualityApplyCap(redis: RedisService, storeId: string): Promise<void> {
  let n = 0;
  try {
    const key = `qa:apply:${storeId}:${new Date().toISOString().slice(0, 10)}`;
    n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 36 * 3600);
  } catch {
    return;
  }
  if (n > QUALITY_APPLY_DAILY_CAP) {
    throw new HttpException('quality apply daily cap', HttpStatus.TOO_MANY_REQUESTS);
  }
}
