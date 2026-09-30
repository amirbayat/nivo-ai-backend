import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

// docs/PRD-buyer-abuse-rate-limit.md — پنجره‌ی لغزان ساده (INCR+EXPIRE، همان الگوی
// sales.service.ts) به‌ازای customerId؛ عدد اولیه، طبق سند باید با داده‌ی واقعی کالیبره شود
const WINDOW_SECONDS = 5 * 60;
const MAX_MESSAGES_PER_WINDOW = 20;
const LOCK_MINUTES = 30;

@Injectable()
export class AbuseGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // باید همین ابتدای هر پیام/اکشن واقعی مشتری (قبل از هر فراخوان AI) صدا زده شود.
  // justLocked=true یعنی همین لحظه قفل شد (یک پیام اطلاع‌رسانی واحد لازم است)؛
  // blocked=true و justLocked=false یعنی از قبل قفل بوده (سکوت کامل، طبق تصمیم بخش ۵ سند).
  async checkAndRecord(
    customerId: string,
  ): Promise<{ blocked: boolean; justLocked: boolean }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { lockedUntil: true },
    });
    if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
      return { blocked: true, justLocked: false };
    }

    const key = `abuse:msg:${customerId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, WINDOW_SECONDS);

    if (count > MAX_MESSAGES_PER_WINDOW) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      });
      return { blocked: true, justLocked: true };
    }

    return { blocked: false, justLocked: false };
  }
}
