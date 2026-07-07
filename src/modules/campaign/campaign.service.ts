import { Injectable, NotFoundException } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { ConfigService } from '@nestjs/config'
import { SmsService } from '../../sms/sms.service'
import { fa } from '../../i18n/fa'
import type { LaunchCampaign, WaitlistEntry } from '@prisma/client'

const ACTIVE_CAMPAIGN_CACHE_KEY = 'campaign:active'
const ACTIVE_CAMPAIGN_CACHE_TTL = 60
const WAITING_LIMIT_CACHE_TTL = 120

function iranToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10))
}

function hashToInt(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export interface DisplayedCounter {
  active: boolean
  campaignName: string | null
  displayedRemaining: number | null
}

type ReminderStep = { dayOffset: number; template: string }

/**
 * کمپین سافت‌لانچ ظرفیت‌محور + لیست انتظار (docs/PRD-global-budget-gateway.md بخش ۱۸).
 * این گیت فقط روی اولین ثبت‌نام کاربر جدید اعمال می‌شود.
 */
@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  async getActiveCampaign(): Promise<LaunchCampaign | null> {
    const cached = await this.redis.get(ACTIVE_CAMPAIGN_CACHE_KEY)
    if (cached) return cached === 'null' ? null : this.reviveCampaignDates(JSON.parse(cached))

    const campaign = await this.prisma.launchCampaign.findFirst({ where: { status: 'ACTIVE' } })
    await this.redis.set(
      ACTIVE_CAMPAIGN_CACHE_KEY,
      campaign ? JSON.stringify(campaign) : 'null',
      'EX',
      ACTIVE_CAMPAIGN_CACHE_TTL,
    )
    return campaign
  }

  // Redis فقط رشته ذخیره می‌کند — بعد از JSON.parse فیلدهای Date به string
  // تبدیل می‌شوند و .getTime() در getDisplayedCounter می‌شکند؛ باید احیا شوند
  private reviveCampaignDates(raw: LaunchCampaign): LaunchCampaign {
    return {
      ...raw,
      startAt: new Date(raw.startAt),
      endAt: raw.endAt ? new Date(raw.endAt) : null,
      createdAt: new Date(raw.createdAt),
    }
  }

  private async invalidateActiveCampaignCache() {
    await this.redis.del(ACTIVE_CAMPAIGN_CACHE_KEY)
  }

  /**
   * فقط برای اولین ثبت‌نام کاربر جدید صدا زده می‌شود (AuthService.verifyOtp).
   * برمی‌گرداند: null اگر کمپین فعالی نیست یا ظرفیت باز بود (دسترسی عادی)،
   * وگرنه پیام انگیزشی + موقعیت در صف.
   */
  async applyToNewUser(userId: string, phone: string): Promise<{ message: string; queuePosition: number } | null> {
    const campaign = await this.getActiveCampaign()
    if (!campaign || campaign.status !== 'ACTIVE') return null
    if (campaign.endAt && campaign.endAt < new Date()) return null

    // افزایش اتمیک با شرط ظرفیت — مقایسه‌ی دو ستون از همان ردیف با UPDATE اتمیک
    // (بخش ۱۸.۳ — همان کلاس مسئله‌ی استخر اعتبار اضافه، راه‌حل متفاوت چون منبع حقیقت PostgreSQL است)
    const rows = await this.prisma.$queryRaw<{ grantedCount: number }[]>`
      UPDATE launch_campaigns
      SET "grantedCount" = "grantedCount" + 1
      WHERE id = ${campaign.id} AND status = 'ACTIVE' AND "grantedCount" < capacity
      RETURNING "grantedCount"
    `
    if (rows.length > 0) {
      await this.invalidateActiveCampaignCache()
      return null // جا باز بود — دسترسی عادی
    }

    // ظرفیت اصلی پر است → لیست انتظار. نکته: حتی اگر خودِ لیست انتظار هم به سقفش
    // رسیده باشد (بخش ۱۸.۱۵)، کاربر همچنان ثبت‌نام و وارد می‌شود — فقط پیام
    // متفاوتی می‌بیند. رد کردن کامل درخواست اینجا یعنی شکستن کل فرآیند لاگین،
    // که هزینه‌اش (تجربه‌ی کاربری بد) بیشتر از فایده‌ی این سقف است.
    const waitingCount =
      campaign.maxWaitlistSize !== null
        ? await this.prisma.waitlistEntry.count({ where: { campaignId: campaign.id, status: 'WAITING' } })
        : 0
    const waitlistIsFull = campaign.maxWaitlistSize !== null && waitingCount >= campaign.maxWaitlistSize

    const entry = await this.prisma.waitlistEntry.create({
      data: { campaignId: campaign.id, userId, phone, activationToken: crypto.randomBytes(24).toString('hex') },
    })
    const queuePosition = await this.prisma.waitlistEntry.count({
      where: { campaignId: campaign.id, status: 'WAITING', createdAt: { lte: entry.createdAt } },
    })
    const message = waitlistIsFull && campaign.waitlistFullMessage ? campaign.waitlistFullMessage : campaign.waitlistMessage
    return { message, queuePosition }
  }

  /** preflight در chat.service.ts — null یعنی محدودیت موقتی روی این کاربر نیست */
  async getWaitingDailyLimit(userId: string): Promise<number | null> {
    const cacheKey = this.waitingLimitCacheKey(userId)
    const cached = await this.redis.get(cacheKey)
    if (cached) return cached === 'null' ? null : Number(cached)

    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { userId },
      include: { campaign: true },
    })
    const limit = entry && entry.status === 'WAITING' ? entry.campaign.waitlistDailyMessageLimit : null
    await this.redis.set(cacheKey, limit === null ? 'null' : String(limit), 'EX', WAITING_LIMIT_CACHE_TTL)
    return limit
  }

  private waitingLimitCacheKey(userId: string) {
    return `waitlist:limit:${userId}`
  }

  // باید هر جا status یک WaitlistEntry عوض می‌شود (grant/activate) صدا زده شود
  // وگرنه کاربری که تازه GRANTED/ACTIVATED شده تا ۲ دقیقه با سقف قدیمی گیر می‌کند
  // (باگ واقعی — با اجرای زنده روی دیتابیس واقعی پیدا شد)
  private async invalidateWaitingLimitCache(userId: string) {
    await this.redis.del(this.waitingLimitCacheKey(userId))
  }

  /** شمارنده‌ی نمایشی صفحه‌ی لاگین — مستقل از ظرفیت واقعی (بخش ۱۸.۱) */
  async getDisplayedCounter(): Promise<DisplayedCounter> {
    const campaign = await this.getActiveCampaign()
    if (!campaign || !campaign.displayCounterEnabled) {
      return { active: Boolean(campaign), campaignName: campaign?.name ?? null, displayedRemaining: null }
    }

    const initial = Math.ceil((campaign.capacity * campaign.displayInitialPct) / 100)
    const tickMs = campaign.displayTickSeconds * 1000
    const tickIndex = Math.floor((Date.now() - campaign.startAt.getTime()) / tickMs)

    let remaining = initial
    for (let i = 0; i < tickIndex && remaining > campaign.displayFloor; i++) {
      const seed = hashToInt(`${campaign.id}:${i}`)
      const range = campaign.displayDecrementMax - campaign.displayDecrementMin + 1
      const dec = campaign.displayDecrementMin + (seed % range)
      remaining -= dec
    }
    remaining = Math.max(campaign.displayFloor, remaining)

    return { active: true, campaignName: campaign.name, displayedRemaining: remaining }
  }

  /** موقعیت فعلی کاربر در صف — برای نمایش «شما نفر N هستید» در اپ، نه فقط لحظه‌ی ثبت‌نام */
  async getMyWaitlistStatus(userId: string): Promise<{ status: string; queuePosition: number | null } | null> {
    const entry = await this.prisma.waitlistEntry.findUnique({ where: { userId } })
    if (!entry) return null
    if (entry.status !== 'WAITING') return { status: entry.status, queuePosition: null }

    const position = await this.prisma.waitlistEntry.count({
      where: { campaignId: entry.campaignId, status: 'WAITING', createdAt: { lte: entry.createdAt } },
    })
    return { status: entry.status, queuePosition: position }
  }

  async activateByToken(token: string): Promise<void> {
    const entry = await this.prisma.waitlistEntry.findUnique({ where: { activationToken: token } })
    if (!entry) throw new NotFoundException(fa.waitlist.invalidToken)
    if (entry.status === 'GRANTED') {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'ACTIVATED', activatedAt: new Date() },
      })
      await this.invalidateWaitingLimitCache(entry.userId)
    }
  }

  // ─── اقدام دستی ادمین ────────────────────────────────────────────────────────

  async grantAccess(campaignId: string, mode: 'all' | number): Promise<{ granted: number }> {
    const entries = await this.prisma.waitlistEntry.findMany({
      where: { campaignId, status: 'WAITING' },
      orderBy: { createdAt: 'asc' }, // قدیمی‌ترین‌ها اول
      take: mode === 'all' ? undefined : mode,
    })
    await this.grantEntries(entries)
    return { granted: entries.length }
  }

  /** آزاد کردن دستی دسترسی برای یک شماره‌ی مشخص — بدون توجه به ترتیب صف (مثلاً یک آشنا/VIP) */
  async grantAccessToPhone(phone: string): Promise<{ granted: boolean }> {
    const entry = await this.prisma.waitlistEntry.findFirst({ where: { phone, status: 'WAITING' } })
    if (!entry) return { granted: false }
    await this.grantEntries([entry])
    return { granted: true }
  }

  private async grantEntries(entries: WaitlistEntry[]): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL')
    for (const entry of entries) {
      const campaign = await this.prisma.launchCampaign.findUnique({ where: { id: entry.campaignId } })
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'GRANTED', grantedAt: new Date() },
      })
      await this.invalidateWaitingLimitCache(entry.userId)
      if (campaign?.grantedSmsTemplate) {
        const link = `${appUrl}/login?wl=${entry.activationToken}`
        this.sms.sendByTemplate(entry.phone, campaign.grantedSmsTemplate, { token: link }).catch(() => {})
      }
    }
  }

  // ─── مراحل یادآوری (Cron شبانه — بخش ۱۸.۶) ───────────────────────────────────

  async sendDueReminders(): Promise<void> {
    const granted = await this.prisma.waitlistEntry.findMany({
      where: { status: 'GRANTED' },
      include: { campaign: true },
    })

    for (const entry of granted) {
      const steps = (entry.campaign.reminderSteps as ReminderStep[]).sort((a, b) => a.dayOffset - b.dayOffset)
      if (!steps.length) continue

      const daysSinceGrant = Math.floor((Date.now() - entry.grantedAt!.getTime()) / 86_400_000)
      const nextStepIndex = (entry.lastReminderStepSent ?? -1) + 1
      const nextStep = steps[nextStepIndex]
      if (!nextStep || daysSinceGrant < nextStep.dayOffset) continue

      await this.sms.sendByTemplate(entry.phone, nextStep.template).catch(() => {})
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { lastReminderStepSent: nextStepIndex, lastReminderSentAt: new Date() },
      })
    }
  }

  // ─── CRUD کمپین (ادمین) ───────────────────────────────────────────────────────

  async listCampaigns() {
    return this.prisma.launchCampaign.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async createCampaign(data: {
    name: string
    startAt: Date
    endAt?: Date | null
    capacity: number
    maxWaitlistSize?: number | null
    waitlistMessage: string
    waitlistFullMessage?: string | null
    waitlistDailyMessageLimit?: number
    displayCounterEnabled?: boolean
    displayInitialPct?: number
    displayFloor?: number
    displayTickSeconds?: number
    displayDecrementMin?: number
    displayDecrementMax?: number
    grantedSmsTemplate?: string | null
    reminderSteps?: ReminderStep[]
  }) {
    // فقط یک کمپین هم‌زمان ACTIVE — مثل الگوی GlobalCreditCycle
    const existingActive = await this.prisma.launchCampaign.findFirst({ where: { status: 'ACTIVE' } })
    if (existingActive) {
      await this.prisma.launchCampaign.update({ where: { id: existingActive.id }, data: { status: 'CLOSED' } })
    }
    const campaign = await this.prisma.launchCampaign.create({ data })
    await this.invalidateActiveCampaignCache()
    return campaign
  }

  async updateCampaign(id: string, data: Record<string, unknown>) {
    const campaign = await this.prisma.launchCampaign.update({ where: { id }, data })
    await this.invalidateActiveCampaignCache()
    return campaign
  }

  async closeCampaign(id: string) {
    const campaign = await this.prisma.launchCampaign.update({ where: { id }, data: { status: 'CLOSED' } })
    await this.invalidateActiveCampaignCache()
    return campaign
  }

  async getWaitlist(campaignId: string, status?: string) {
    return this.prisma.waitlistEntry.findMany({
      where: { campaignId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'asc' },
    })
  }
}
