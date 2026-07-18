import {
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { SmsService } from '../../sms/sms.service'
import { CampaignService } from '../campaign/campaign.service'
import { DeviceTokensService } from '../device-tokens/device-tokens.service'
import { generateShortCode } from '../../common/utils/generate-code'
import { normalizePhone } from '../../common/utils/normalize-phone'
import { fa } from '../../i18n/fa'

// مقادیر پیش‌فرض — همه از طریق env variable قابل بازنویسی‌اند (به ثانیه)
const DEFAULT_OTP_TTL = 120        // OTP_TTL_SECONDS
const DEFAULT_OTP_RATE_LIMIT = 3   // OTP_RATE_LIMIT — حداکثر تعداد ارسال در بازه
const DEFAULT_OTP_RATE_WINDOW = 600 // OTP_RATE_WINDOW_SECONDS — ۱۰ دقیقه
const DEFAULT_OTP_ATTEMPT_LIMIT = 5 // OTP_ATTEMPT_LIMIT
const DEFAULT_OTP_ATTEMPT_WINDOW = 1800 // OTP_ATTEMPT_WINDOW_SECONDS — ۳۰ دقیقه

// حساب تستی ثابت — بدون ارسال پیامک واقعی، بدون rate limit
// فقط وقتی env variable به نام TEST_USER برابر 'true' باشد فعال است (پیش‌فرض: غیرفعال)
const TEST_PHONE = '09001111111'
const TEST_OTP_CODE = '123654'
const TEST_USER_NAME = 'تست'

const PLAN_SUMMARY_SELECT = {
  name: true,
  priceMonthly: true,
  dailyFreeTokens: true,
  monthlyTotalTokens: true,
  allowedModels: true,
  featuredModels: true,
  featuredModelsCount: true,
} as const

function otpKey(phone: string) { return `otp:${phone}` }
function otpRateKey(phone: string) { return `otp:rate:${phone}` }
function otpAttemptKey(phone: string) { return `otp:attempt:${phone}` }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly campaign: CampaignService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  private isTestUserEnabled(): boolean {
    return this.config.get<string>('TEST_USER', 'false') === 'true'
  }

  private getOtpTtl(): number {
    return Number(this.config.get('OTP_TTL_SECONDS', String(DEFAULT_OTP_TTL)))
  }

  private getOtpRateLimit(): number {
    return Number(this.config.get('OTP_RATE_LIMIT', String(DEFAULT_OTP_RATE_LIMIT)))
  }

  private getOtpRateWindow(): number {
    return Number(this.config.get('OTP_RATE_WINDOW_SECONDS', String(DEFAULT_OTP_RATE_WINDOW)))
  }

  private getOtpAttemptLimit(): number {
    return Number(this.config.get('OTP_ATTEMPT_LIMIT', String(DEFAULT_OTP_ATTEMPT_LIMIT)))
  }

  private getOtpAttemptWindow(): number {
    return Number(this.config.get('OTP_ATTEMPT_WINDOW_SECONDS', String(DEFAULT_OTP_ATTEMPT_WINDOW)))
  }

  async sendOtp(rawPhone: string): Promise<{ message: string }> {
    const phone = normalizePhone(rawPhone)

    if (phone === TEST_PHONE && this.isTestUserEnabled()) {
      return { message: fa.auth.otpSent }
    }

    // rate limit: حداکثر تعداد ارسال در بازه (پیش‌فرض ۳ بار / ۱۰ دقیقه)
    const rateWindow = this.getOtpRateWindow()
    const rateKey = otpRateKey(phone)
    const sends = await this.redis.incr(rateKey)
    if (sends === 1) await this.redis.expire(rateKey, rateWindow)
    if (sends > this.getOtpRateLimit()) {
      throw new HttpException(fa.auth.otpTooManyRequests(Math.ceil(rateWindow / 60)), 429)
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    await this.redis.set(otpKey(phone), code, 'EX', this.getOtpTtl())

    await this.sms.sendOtp(phone, code)

    return { message: fa.auth.otpSent }
  }

  isOtpViewerEnabled(): boolean {
    // برای پشتیبانی («کد رو نگرفتم») و دیباگ — بعداً از طریق env قابل خاموش‌کردن (پیش‌فرض: فعال)
    return this.config.get<string>('OTP_ADMIN_VIEWER_ENABLED', 'true') === 'true'
  }

  // لیست کدهای OTP فعال (منقضی‌نشده) در Redis، برای پنل ادمین
  async listActiveOtps(): Promise<
    { phone: string; code: string; name: string | null; expiresInSeconds: number }[]
  > {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'otp:*', 'COUNT', 200)
      cursor = next
      // فقط otp:PHONE (دو تکه) — نه otp:rate:PHONE / otp:attempt:PHONE که شمارنده‌اند نه خود کد
      keys.push(...batch.filter(k => k.split(':').length === 2))
    } while (cursor !== '0')

    if (keys.length === 0) return []

    const pipeline = this.redis.pipeline()
    for (const key of keys) {
      pipeline.get(key)
      pipeline.ttl(key)
    }
    const results = await pipeline.exec()

    const phones = keys.map(key => key.slice('otp:'.length))
    const users = await this.prisma.user.findMany({
      where: { phone: { in: phones } },
      select: { phone: true, name: true },
    })
    const nameByPhone = new Map(users.map(u => [u.phone, u.name]))

    return phones
      .map((phone, i) => ({
        phone,
        code: (results?.[i * 2]?.[1] as string | null) ?? '',
        name: nameByPhone.get(phone) ?? null,
        expiresInSeconds: Math.max(0, (results?.[i * 2 + 1]?.[1] as number) ?? 0),
      }))
      .sort((a, b) => b.expiresInSeconds - a.expiresInSeconds)
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const code = generateShortCode()
      const clash = await this.prisma.user.findUnique({ where: { referralCode: code } })
      if (!clash) return code
      if (attempt > 5) throw new Error('failed to generate unique referral code')
    }
  }

  async verifyOtp(rawPhone: string, code: string, referralCode?: string, deviceUuid?: string) {
    const phone = normalizePhone(rawPhone)
    const isTestPhone = phone === TEST_PHONE && this.isTestUserEnabled()

    if (isTestPhone) {
      if (code !== TEST_OTP_CODE) throw new UnauthorizedException(fa.auth.otpInvalid)
    } else {
      // attempt limit: حداکثر تعداد تلاش در بازه (پیش‌فرض ۵ بار / ۳۰ دقیقه)
      const attemptWindow = this.getOtpAttemptWindow()
      const attemptKey = otpAttemptKey(phone)
      const attempts = await this.redis.incr(attemptKey)
      if (attempts === 1) await this.redis.expire(attemptKey, attemptWindow)
      if (attempts > this.getOtpAttemptLimit()) {
        throw new HttpException(fa.auth.otpTooManyAttempts(Math.ceil(attemptWindow / 60)), 429)
      }

      const stored = await this.redis.get(otpKey(phone))
      if (!stored) throw new UnauthorizedException(fa.auth.otpExpired)
      if (stored !== code) throw new UnauthorizedException(fa.auth.otpInvalid)

      // clear otp + counters after success
      await this.redis.del(otpKey(phone), otpRateKey(phone), attemptKey)
    }

    // upsert نمی‌تواند بگوید رکورد جدید ساخته شد یا از قبل بود — برای گیت کمپین
    // سافت‌لانچ (فقط روی اولین ثبت‌نام) باید صریح جدا شود
    const existing = await this.prisma.user.findUnique({ where: { phone } })
    let referredByUserId: string | undefined
    if (!existing && referralCode) {
      // کد معرفی نامعتبر باید بی‌صدا نادیده گرفته شود، نه ثبت‌نام را fail کند
      const referrer = await this.prisma.user.findUnique({ where: { referralCode } })
      referredByUserId = referrer?.id
    }
    const user = existing ?? (await this.prisma.user.create({
      data: {
        phone,
        referralCode: await this.generateUniqueReferralCode(),
        ...(referredByUserId ? { referredByUserId } : {}),
        ...(isTestPhone ? { name: TEST_USER_NAME } : {}),
      },
    }))
    const isNewUser = !existing

    if (!user.isActive) throw new UnauthorizedException(fa.auth.userDisabled)

    // docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴ — توکن پوش ناشناسی که
    // این دستگاه قبل از لاگین ثبت کرده بود را به این کاربر وصل می‌کند؛ شکست این کار نباید لاگین را fail کند
    if (deviceUuid) {
      await this.deviceTokens
        .attachToUser(deviceUuid, user.id)
        .catch((err) => this.logger.error(`attachToUser failed for deviceUuid=${deviceUuid} user=${user.id}`, err))
    }

    // حساب تستی هیچ‌وقت پشت گیت waitlist سافت‌لانچ گیر نمی‌افتد
    let waitlisted: { message: string; queuePosition: number } | null = null
    if (isNewUser && !isTestPhone) {
      waitlisted = await this.campaign.applyToNewUser(user.id, user.phone)
    }

    const tokens = await this.issueTokens(user.id, user.phone, user.role)
    return {
      ...tokens,
      user: { id: user.id, phone: user.phone, role: user.role, name: user.name },
      waitlisted,
    }
  }

  async refresh(rawToken: string) {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException(fa.auth.refreshTokenInvalid)
    }
    if (!stored.user.isActive) throw new UnauthorizedException(fa.auth.userDisabled)

    // rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    })

    return this.issueTokens(stored.user.id, stored.user.phone, stored.user.role)
  }

  async logout(rawToken: string) {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex')
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    })
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        createdAt: true,
        referralCode: true,
        subscription: {
          select: {
            status: true,
            periodEnd: true,
            plan: { select: PLAN_SUMMARY_SELECT },
          },
        },
      },
    })
    if (!user) return null

    // کاربر رایگان هیچ‌وقت رکورد Subscription ندارد (فقط با خرید ساخته می‌شود) — پس بدون این
    // fallback، تنظیمات پلن رایگان (مثل featuredModels) هیچ‌وقت به فرانت نمی‌رسید. همون قرارداد
    // «پلن رایگان = priceMonthly صفر» که token.service.ts (getCachedPlan) هم برای سهمیه/مسیریابی
    // مدل استفاده می‌کند، اینجا هم برای همون هدف تکرار شده.
    const plan = user.subscription?.plan ?? await this.prisma.plan.findFirst({
      where: { priceMonthly: 0, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: PLAN_SUMMARY_SELECT,
    })

    return { ...user, plan }
  }

  private async issueTokens(userId: string, phone: string, role: string) {
    const payload = { sub: userId, phone, role }

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN'),
    })

    const refreshToken = crypto.randomBytes(40).toString('hex')
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    })

    return { accessToken, refreshToken }
  }
}
