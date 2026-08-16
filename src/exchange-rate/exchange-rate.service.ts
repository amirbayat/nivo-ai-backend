import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

const REDIS_KEY = 'exchange:usdt_toman';
const REDIS_UPDATED_AT_KEY = 'exchange:usdt_toman:updated_at';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const API_URL = 'https://api.tetherland.com/currencies';
const FALLBACK_RATE_KEY = 'USD_TO_TOMAN';

export interface RateInfo {
  toman: number;
  updatedAt: string | null; // null یعنی هیچ‌وقت رفرش زنده موفق نشده و مقدار fallback است
  source: 'live' | 'fallback';
}

@Injectable()
export class ExchangeRateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeRateService.name);
  private readonly fallbackRate: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    // USD_TO_TOMAN مستقیماً تومانی است (مثلاً ۹۰٬۰۰۰ تومان) — تترلند هم تومان برمی‌گرداند، پس دیگر تبدیلی لازم نیست
    this.fallbackRate = Number(this.config.get(FALLBACK_RATE_KEY, '90000'));
  }

  async onModuleInit() {
    await this.refresh();
    this.intervalId = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async getUsdtToman(): Promise<number> {
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) return Number(cached);
    return this.fallbackRate;
  }

  // برای نمایش «آخرین بروزرسانی نرخ دلار» در پنل ادمین — چون getUsdtToman() فقط
  // عدد رو برمی‌گردونه و به‌صورت شفاف نمی‌گه از کش زنده استفاده شده یا از fallback ثابت
  async getRateInfo(): Promise<RateInfo> {
    const [cached, updatedAt] = await Promise.all([
      this.redis.get(REDIS_KEY),
      this.redis.get(REDIS_UPDATED_AT_KEY),
    ]);
    if (cached)
      return {
        toman: Number(cached),
        updatedAt: updatedAt ?? null,
        source: 'live',
      };
    return { toman: this.fallbackRate, updatedAt: null, source: 'fallback' };
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as {
        status: number;
        data: { currencies: { USDT?: { price: number } } };
      };

      const price = body?.data?.currencies?.USDT?.price;
      if (!price || price <= 0) throw new Error('invalid price in response');

      // تترلند قیمت را به تومان برمی‌گرداند — نیازی به تبدیل نیست
      await Promise.all([
        this.redis.set(REDIS_KEY, String(price), 'EX', 600), // 10 min TTL
        this.redis.set(
          REDIS_UPDATED_AT_KEY,
          new Date().toISOString(),
          'EX',
          600,
        ),
      ]);
      this.logger.log(`USDT/Toman updated: ${price.toLocaleString()}`);
    } catch (err) {
      this.logger.warn(
        `Exchange rate refresh failed — using cached/fallback. ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
