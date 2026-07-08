import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../redis/redis.service'

const REDIS_KEY = 'exchange:usdt_rial'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const API_URL = 'https://api.tetherland.com/currencies'
const FALLBACK_RATE_KEY = 'USD_TO_RIAL'

@Injectable()
export class ExchangeRateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeRateService.name)
  private readonly fallbackRate: number
  private intervalId: NodeJS.Timeout | null = null

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    // USD_TO_RIAL به‌صورت تومانی تنظیم می‌شود (مثلاً ۹۰۰٬۰۰۰ تومان) — در ۱۰ ضرب می‌شود تا واقعاً ریال باشد
    this.fallbackRate = Number(this.config.get(FALLBACK_RATE_KEY, '900000')) * 10
  }

  async onModuleInit() {
    await this.refresh()
    this.intervalId = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  async getUsdtRial(): Promise<number> {
    const cached = await this.redis.get(REDIS_KEY)
    if (cached) return Number(cached)
    return this.fallbackRate
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(API_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const body = (await res.json()) as {
        status: number
        data: { currencies: { USDT?: { price: number } } }
      }

      const price = body?.data?.currencies?.USDT?.price
      if (!price || price <= 0) throw new Error('invalid price in response')

      // تترلند قیمت را به تومان برمی‌گرداند — برای ذخیره‌ی واقعاً ریالی در ۱۰ ضرب می‌شود
      const priceRial = price * 10
      await this.redis.set(REDIS_KEY, String(priceRial), 'EX', 600) // 10 min TTL
      this.logger.log(`USDT/Rial updated: ${priceRial.toLocaleString()}`)
    } catch (err) {
      this.logger.warn(`Exchange rate refresh failed — using cached/fallback. ${err instanceof Error ? err.message : err}`)
    }
  }
}
