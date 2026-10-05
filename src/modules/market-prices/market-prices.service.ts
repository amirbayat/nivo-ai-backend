import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

const REDIS_KEY = 'market:gold';
const REDIS_UPDATED_AT_KEY = 'market:gold:updated_at';
const REFRESH_INTERVAL_MS = 80 * 1000;
const CACHE_TTL_SECONDS = 180; // ۲ برابر interval — طبق الگوی exchange-rate.service.ts
const API_URL = 'https://api.brsapi.ir/Market/Gold_Currency.php';

export interface GoldPriceItem {
  symbol: string;
  name: string;
  name_en: string;
  price: number;
  change_value: number;
  change_percent: number;
  unit: string;
}

export interface GoldPricesResult {
  items: GoldPriceItem[];
  updatedAt: string | null; // null یعنی هیچ‌وقت رفرش زنده موفق نشده
  source: 'live' | 'unavailable';
}

@Injectable()
export class MarketPricesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketPricesService.name);
  private readonly apiKey?: string;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('BRSAPI_API_KEY');
  }

  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn(
        'BRSAPI_API_KEY تنظیم نشده — قیمت طلا آپدیت نمی‌شود (پاسخ endpoint خالی خواهد بود)',
      );
      return;
    }
    await this.refresh();
    this.intervalId = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async getGoldPrices(): Promise<GoldPricesResult> {
    const [cached, updatedAt] = await Promise.all([
      this.redis.get(REDIS_KEY),
      this.redis.get(REDIS_UPDATED_AT_KEY),
    ]);
    if (cached) {
      return {
        items: JSON.parse(cached) as GoldPriceItem[],
        updatedAt: updatedAt ?? null,
        source: 'live',
      };
    }
    return { items: [], updatedAt: null, source: 'unavailable' };
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(`${API_URL}?key=${this.apiKey}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as { gold?: GoldPriceItem[] };
      const items = body?.gold;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('invalid/empty gold array in response');
      }

      await Promise.all([
        this.redis.set(
          REDIS_KEY,
          JSON.stringify(items),
          'EX',
          CACHE_TTL_SECONDS,
        ),
        this.redis.set(
          REDIS_UPDATED_AT_KEY,
          new Date().toISOString(),
          'EX',
          CACHE_TTL_SECONDS,
        ),
      ]);
      this.logger.log(`Gold prices updated (${items.length} symbols)`);
    } catch (err) {
      this.logger.warn(
        `Gold price refresh failed — کش قبلی (اگر TTL رد نشده) همچنان serve می‌شود. ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
