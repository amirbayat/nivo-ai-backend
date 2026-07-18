import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'
import { RedisService } from '../../redis/redis.service'

export type LiaraCallType = 'chat' | 'title' | 'summary' | 'routing'

export interface LiaraStatsBucket {
  total: number
  success: number
  fail: number
  // میانگین تأخیر ترکیبی هر ۴ نوع تماس با هم — چون «چت» (چند ثانیه، شامل کل تولید پاسخ) و
  // «مسیریابی» (زیر یک ثانیه) مقیاس کاملاً متفاوتی دارند، این عدد به‌تنهایی گمراه‌کننده است؛
  // avgLatencyMsByType را برای مقایسه‌ی معنادار استفاده کنید
  avgLatencyMs: number
  byType: Record<LiaraCallType, number>
  avgLatencyMsByType: Record<LiaraCallType, number>
}

const ACTIVE_STREAMS_KEY = 'live:active_streams'
// یک پاسخ چت هرگز نباید بیش از این طول بکشد — برای پاک‌سازی خودکار entry های یتیم (کرش/ری‌استارت
// وسط استریم که trackStreamEnd هرگز صدا زده نشد) بدون نیاز به هیچ job پاک‌سازی جدا
const MAX_STREAM_AGE_MS = 10 * 60_000

function minuteBucket(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '') // YYYYMMDDHHmm
}
function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
}

const CALL_TYPES: LiaraCallType[] = ['chat', 'title', 'summary', 'routing']

function parseStatsHash(raw: Record<string, string> | null): LiaraStatsBucket {
  const total = Number(raw?.total ?? 0)
  const success = Number(raw?.success ?? 0)
  const fail = Number(raw?.fail ?? 0)
  const latencySumMs = Number(raw?.latencySumMs ?? 0)

  const byType = {} as Record<LiaraCallType, number>
  const avgLatencyMsByType = {} as Record<LiaraCallType, number>
  for (const type of CALL_TYPES) {
    const count = Number(raw?.[`type:${type}`] ?? 0)
    const typeLatencySum = Number(raw?.[`latencySumMs:${type}`] ?? 0)
    byType[type] = count
    avgLatencyMsByType[type] = count > 0 ? Math.round(typeLatencySum / count) : 0
  }

  return {
    total,
    success,
    fail,
    avgLatencyMs: total > 0 ? Math.round(latencySumMs / total) : 0,
    byType,
    avgLatencyMsByType,
  }
}

/**
 * آمار زنده‌ی چت — دو چیز جدا را ردیابی می‌کند:
 *  ۱) تعداد استریم‌های فعال همین لحظه (ZSET خودترمیم‌شونده — بدون نیاز به job پاک‌سازی)
 *  ۲) تعداد/موفقیت/تأخیر تماس‌های Liara، در سطل‌های دقیقه‌ای (برای نمودار) + یک رول‌آپ روزانه (برای «امروز»)
 * فقط شمارنده است، نه لاگ محتوا — هیچ متن پیام/پاسخی اینجا ذخیره نمی‌شود.
 */
@Injectable()
export class LiveStatsService {
  constructor(private readonly redis: RedisService) {}

  async trackStreamStart(): Promise<string> {
    const id = crypto.randomUUID()
    const now = Date.now()
    await this.redis.zadd(ACTIVE_STREAMS_KEY, now, id)
    // پیک هم‌زمانی امروز — همین‌جا (نه با یک job نمونه‌بردار جدا) به‌روزرسانی می‌شود، چون
    // هم‌زمانی خودش یک gauge لحظه‌ای است، نه شمارنده‌ی افزایشی؛ فقط نقطه‌ای که تغییر می‌کند
    // (شروع/پایان یک استریم) فرصت درستی برای نمونه‌برداری آن است
    this.bumpDailyPeak(now).catch(() => {})
    return id
  }

  private async bumpDailyPeak(now: number): Promise<void> {
    const current = await this.redis.zcard(ACTIVE_STREAMS_KEY)
    const peakKey = `live:daily-peak:${dayBucket(new Date(now))}`
    const existing = Number((await this.redis.get(peakKey)) ?? 0)
    // race خفیف بین چند درخواست هم‌زمان ممکن است، ولی این فقط یک عدد نمایشی برای داشبورد است؛
    // خودش را در همان لحظات پرترافیک (که دقیقاً وقتی مهم است) مکرراً تصحیح می‌کند
    if (current > existing) {
      await this.redis.set(peakKey, current, 'EX', 90 * 86400) // ۹۰ روز — کافی برای روند چند ماهه
    }
  }

  async trackStreamEnd(id: string): Promise<void> {
    await this.redis.zrem(ACTIVE_STREAMS_KEY, id)
  }

  async getActiveStreamCount(): Promise<number> {
    const now = Date.now()
    await this.redis.zremrangebyscore(ACTIVE_STREAMS_KEY, 0, now - MAX_STREAM_AGE_MS)
    return this.redis.zcard(ACTIVE_STREAMS_KEY)
  }

  async recordLiaraCall(type: LiaraCallType, success: boolean, latencyMs: number): Promise<void> {
    const now = new Date()
    const minuteKey = `liara:stats:${minuteBucket(now)}`
    const dayKey = `liara:daily:${dayBucket(now)}`

    const roundedLatency = Math.max(0, Math.round(latencyMs))
    const pipeline = this.redis.pipeline()
    for (const key of [minuteKey, dayKey]) {
      pipeline.hincrby(key, 'total', 1)
      pipeline.hincrby(key, success ? 'success' : 'fail', 1)
      pipeline.hincrby(key, `type:${type}`, 1)
      pipeline.hincrby(key, 'latencySumMs', roundedLatency)
      pipeline.hincrby(key, `latencySumMs:${type}`, roundedLatency)
    }
    pipeline.expire(minuteKey, 3 * 86400) // ۳ روز — کافی برای نمودار «۲۴ ساعت اخیر»
    pipeline.expire(dayKey, 8 * 86400) // ۸ روز — کافی برای مقایسه‌ی هفتگی ساده
    await pipeline.exec()
  }

  async getTodayStats(): Promise<LiaraStatsBucket> {
    const raw = await this.redis.hgetall(`liara:daily:${dayBucket(new Date())}`)
    return parseStatsHash(raw)
  }

  /** خطای ۵xx بک‌اند را در همان الگوی سطل دقیقه‌ای ثبت می‌کند —
   * docs/PRD-admin-notifications-and-mobile.md بخش ۴ (SYSTEM_ERROR_SPIKE) این را می‌خواند */
  async recordServerError(): Promise<void> {
    const key = `sys:err:${minuteBucket(new Date())}`
    const pipeline = this.redis.pipeline()
    pipeline.hincrby(key, 'count', 1)
    pipeline.expire(key, 3 * 86400)
    await pipeline.exec()
  }

  /** جمع خطای ۵xx در N دقیقه‌ی اخیر — برای چک آستانه‌ی SYSTEM_ERROR_SPIKE */
  async getServerErrorCount(minutes: number): Promise<number> {
    const now = new Date()
    const buckets: string[] = []
    for (let i = 0; i < minutes; i++) {
      buckets.push(minuteBucket(new Date(now.getTime() - i * 60_000)))
    }

    const pipeline = this.redis.pipeline()
    buckets.forEach((b) => pipeline.hget(`sys:err:${b}`, 'count'))
    const results = await pipeline.exec()

    return buckets.reduce((sum, _b, i) => sum + Number((results?.[i]?.[1] as string | null) ?? 0), 0)
  }

  /** جمع تماس‌های Liara (کل و ناموفق) در N دقیقه‌ی اخیر — برای چک آستانه‌ی LIARA_ERROR_RATE */
  async getLiaraFailureStats(minutes: number): Promise<{ total: number; fail: number }> {
    const series = await this.getTimeseries(minutes)
    return series.reduce(
      (acc, bucket) => ({ total: acc.total + bucket.total, fail: acc.fail + bucket.fail }),
      { total: 0, fail: 0 },
    )
  }

  /** سری زمانی به بازه‌ی دقیقه — برای نمودار «N دقیقه‌ی اخیر» */
  async getTimeseries(minutes: number): Promise<(LiaraStatsBucket & { bucket: string })[]> {
    const now = new Date()
    const buckets: string[] = []
    for (let i = minutes - 1; i >= 0; i--) {
      buckets.push(minuteBucket(new Date(now.getTime() - i * 60_000)))
    }

    const pipeline = this.redis.pipeline()
    buckets.forEach(b => pipeline.hgetall(`liara:stats:${b}`))
    const results = await pipeline.exec()

    return buckets.map((bucket, i) => {
      const raw = (results?.[i]?.[1] as Record<string, string>) ?? null
      return { bucket, ...parseStatsHash(raw) }
    })
  }

  /** پیک هم‌زمانی (حداکثر تعداد چت هم‌زمان مشاهده‌شده) به‌ازای روز — برای نمودار خطی روند */
  async getDailyPeaks(days: number): Promise<{ day: string; peak: number }[]> {
    const now = new Date()
    const dayKeys: string[] = []
    for (let i = days - 1; i >= 0; i--) {
      dayKeys.push(dayBucket(new Date(now.getTime() - i * 86_400_000)))
    }

    const pipeline = this.redis.pipeline()
    dayKeys.forEach(d => pipeline.get(`live:daily-peak:${d}`))
    const results = await pipeline.exec()

    return dayKeys.map((day, i) => ({
      day,
      peak: Number((results?.[i]?.[1] as string | null) ?? 0),
    }))
  }
}
