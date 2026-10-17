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
const REFRESH_INTERVAL_MS = 210 * 1000; // ۳.۵ دقیقه
const CACHE_TTL_SECONDS = 420; // ۲ برابر interval — طبق الگوی exchange-rate.service.ts
const API_URL = 'https://api.ratebox.ir/apijsonv2.php';

// Ratebox برای هر آیتم slug پایدار می‌دهد (نه شماره‌ی آیتم). فقط این‌ها کش می‌شوند و به
// symbol های قدیمی (دوران BrsApi) نگاشت می‌شوند تا مصرف‌کننده‌ها (find18kGoldItem، چت، فرانت)
// دست‌نخورده بمانند. unit='toman' یعنی مقدار ریالیِ Ratebox باید تقسیم بر ۱۰ شود (تأییدشده:
// tether رِیت‌باکس ≈ ۱۰ برابر USDT تترلند به تومان).
const SLUG_MAP: Record<
  string,
  { symbol: string; name_en: string; unit: 'toman' | 'usd' }
> = {
  gold18: { symbol: 'IR_GOLD_18K', name_en: '18K Gold', unit: 'toman' },
  gold24: { symbol: 'IR_GOLD_24K', name_en: '24K Gold', unit: 'toman' },
  mesghal_gold: {
    symbol: 'IR_GOLD_MESGHAL',
    name_en: 'Mesghal Gold',
    unit: 'toman',
  },
  ons_gold: { symbol: 'XAUUSD', name_en: 'Gold Ounce', unit: 'usd' },
  sekebaharazadi: {
    symbol: 'IR_COIN_BAHAR',
    name_en: 'Bahar Azadi Coin',
    unit: 'toman',
  },
  sekeemami: { symbol: 'IR_COIN_EMAMI', name_en: 'Emami Coin', unit: 'toman' },
  nimseke: { symbol: 'IR_COIN_HALF', name_en: 'Half Coin', unit: 'toman' },
  robseke: {
    symbol: 'IR_COIN_QUARTER',
    name_en: 'Quarter Coin',
    unit: 'toman',
  },
  geramiseke: { symbol: 'IR_COIN_1G', name_en: '1g Coin', unit: 'toman' },
};

interface RateboxItem {
  title: string;
  slug: string;
  p: string;
  d: string;
  dp: string;
  dt: string;
}

const toNumber = (v: unknown): number =>
  Number(String(v ?? '').replace(/,/g, ''));

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
  private readonly apiToken?: string;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.apiToken = this.config.get<string>('RATEBOX_API_TOKEN');
  }

  async onModuleInit() {
    if (!this.apiToken) {
      this.logger.warn(
        'RATEBOX_API_TOKEN تنظیم نشده — قیمت طلا آپدیت نمی‌شود (پاسخ endpoint خالی خواهد بود)',
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
      const res = await fetch(
        `${API_URL}?token=${encodeURIComponent(this.apiToken!)}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as { items?: RateboxItem[] };
      if (!Array.isArray(body?.items)) {
        throw new Error('invalid response: items missing');
      }

      const items: GoldPriceItem[] = [];
      for (const raw of body.items) {
        const meta = SLUG_MAP[raw.slug];
        if (!meta) continue;
        const factor = meta.unit === 'toman' ? 10 : 1;
        const price = toNumber(raw.p) / factor;
        // قیمت ۰/نامعتبر یعنی «داده نیست» — کش قبلی را با صفر overwrite نکن
        if (!Number.isFinite(price) || price <= 0) continue;
        const change = toNumber(raw.d) / factor;
        const pct = toNumber(raw.dp);
        const sign = raw.dt === 'low' ? -1 : 1;
        items.push({
          symbol: meta.symbol,
          name: raw.title,
          name_en: meta.name_en,
          price,
          change_value: Number.isFinite(change) ? sign * change : 0,
          change_percent: Number.isFinite(pct) ? sign * pct : 0,
          unit: meta.unit === 'toman' ? 'تومان' : 'دلار',
        });
      }
      if (items.length === 0) {
        throw new Error('no valid gold prices in response');
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
