import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'
import { RedisService } from '../../redis/redis.service'

export type LiaraCallType = 'chat' | 'title' | 'summary' | 'routing'

export interface LiaraStatsBucket {
  total: number
  success: number
  fail: number
  avgLatencyMs: number
  byType: Record<LiaraCallType, number>
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

function parseStatsHash(raw: Record<string, string> | null): LiaraStatsBucket {
  const total = Number(raw?.total ?? 0)
  const success = Number(raw?.success ?? 0)
  const fail = Number(raw?.fail ?? 0)
  const latencySumMs = Number(raw?.latencySumMs ?? 0)
  return {
    total,
    success,
    fail,
    avgLatencyMs: total > 0 ? Math.round(latencySumMs / total) : 0,
    byType: {
      chat: Number(raw?.['type:chat'] ?? 0),
      title: Number(raw?.['type:title'] ?? 0),
      summary: Number(raw?.['type:summary'] ?? 0),
      routing: Number(raw?.['type:routing'] ?? 0),
    },
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
    await this.redis.zadd(ACTIVE_STREAMS_KEY, Date.now(), id)
    return id
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

    const pipeline = this.redis.pipeline()
    for (const key of [minuteKey, dayKey]) {
      pipeline.hincrby(key, 'total', 1)
      pipeline.hincrby(key, success ? 'success' : 'fail', 1)
      pipeline.hincrby(key, `type:${type}`, 1)
      pipeline.hincrby(key, 'latencySumMs', Math.max(0, Math.round(latencyMs)))
    }
    pipeline.expire(minuteKey, 3 * 86400) // ۳ روز — کافی برای نمودار «۲۴ ساعت اخیر»
    pipeline.expire(dayKey, 8 * 86400) // ۸ روز — کافی برای مقایسه‌ی هفتگی ساده
    await pipeline.exec()
  }

  async getTodayStats(): Promise<LiaraStatsBucket> {
    const raw = await this.redis.hgetall(`liara:daily:${dayBucket(new Date())}`)
    return parseStatsHash(raw)
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
}
