import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../../redis/redis.service';
import {
  CONVERSATION_LOCK_ACTION_WAIT_MS,
  CONVERSATION_LOCK_RETRY_INTERVAL_MS,
  CONVERSATION_LOCK_TTL_MS,
  CONVERSATION_PENDING_MAX_MESSAGES,
} from '../../common/constants/sales-ops.constants';

// PRD-nivo-sales-unified.md تسک 0.4 — قفل Redis به‌ازای هر مکالمه. دو پیام سریع/دبل‌تپ
// روی یک مکالمه همزمان contextData را بازنویسی می‌کردند (آیتم سبد گم می‌شد).
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

@Injectable()
export class ConversationLockService {
  constructor(private readonly redis: RedisService) {}

  private lockKey(id: string) {
    return `lock:conv:${id}`;
  }
  private pendingKey(id: string) {
    return `conv:${id}:pending`;
  }

  // توکن برمی‌گرداند یا null اگر قفل دست دیگری است
  async acquire(id: string): Promise<string | null> {
    const token = crypto.randomUUID();
    const ok = await this.redis.set(
      this.lockKey(id),
      token,
      'PX',
      CONVERSATION_LOCK_TTL_MS,
      'NX',
    );
    return ok === 'OK' ? token : null;
  }

  async acquireWithRetry(
    id: string,
    maxWaitMs = CONVERSATION_LOCK_ACTION_WAIT_MS,
  ): Promise<string | null> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const token = await this.acquire(id);
      if (token) return token;
      if (Date.now() >= deadline) return null;
      await new Promise((r) =>
        setTimeout(r, CONVERSATION_LOCK_RETRY_INTERVAL_MS),
      );
    }
  }

  // فقط اگر هنوز صاحب قفل هستیم (token برابر) آزاد می‌کند؛ قفل منقضی‌شده‌ی دیگری را نمی‌شکند
  async release(id: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, this.lockKey(id), token);
  }

  async enqueue(id: string, text: string): Promise<void> {
    const key = this.pendingKey(id);
    await this.redis
      .multi()
      .rpush(key, text)
      .ltrim(key, -CONVERSATION_PENDING_MAX_MESSAGES, -1)
      .expire(key, 600)
      .exec();
  }

  // همه‌ی پیام‌های صف را اتمیک می‌خواند و پاک می‌کند (ترتیب ورود حفظ می‌شود)
  async drain(id: string): Promise<string[]> {
    const key = this.pendingKey(id);
    const res = await this.redis.multi().lrange(key, 0, -1).del(key).exec();
    const items = (res?.[0]?.[1] as string[] | undefined) ?? [];
    return items;
  }

  async pendingCount(id: string): Promise<number> {
    return this.redis.llen(this.pendingKey(id));
  }
}
