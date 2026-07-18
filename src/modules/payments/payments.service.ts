import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentProvider, DiscountSource } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { TokenService } from '../usage/token.service'
import { DiscountCodeService } from '../growth/discount-code.service'
import { GrowthConfigService } from '../growth/growth-config.service'
import { PaymentGatewayRegistry } from './gateways/payment-gateway.registry'
import { PaymentGateway } from './gateways/payment-gateway.interface'
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service'
import { fa } from '../../i18n/fa'
import { InitiatePaymentDto } from './dto/initiate-payment.dto'
import { InitiateWalletTopupDto } from './dto/initiate-wallet-topup.dto'
import type { Payment, Plan, Prisma, User } from '@prisma/client'

const SUBSCRIPTION_DAYS = 30

// docs/PRD-pay-as-you-go-wallet.md بخش ۸ سؤال ۱ — اشتراک PAYG انقضای زمانی معناداری ندارد
// (خالی‌شدن کیف‌پول جلوی ارسال پیام را می‌گیرد، نه گذشتن این تاریخ)؛ برای این‌که schema فعلی
// (periodEnd غیر nullable) بدون تغییر بماند، یک تاریخ خیلی دور به‌جای «بدون انقضا» گذاشته می‌شود
const PAY_AS_YOU_GO_PERIOD_END = new Date('2099-12-31T00:00:00.000Z')

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentGatewayRegistry,
    private readonly tokenService: TokenService,
    private readonly discountCodeService: DiscountCodeService,
    private readonly growthConfigService: GrowthConfigService,
    private readonly config: ConfigService,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  async initiate(userId: string, dto: InitiatePaymentDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } })
    if (!plan) throw new NotFoundException(fa.plans.notFound)
    if (!plan.isActive) throw new BadRequestException(fa.plans.notActive)

    // ── قانون «فقط خرید رو به بالا» — docs/PRD-plan-image-capability-and-upgrade.md بخش ۶ ──
    // وقتی کاربر یک سابسکریپشن معمولی (نه PAYG) فعال دارد، فقط پلن گران‌تر از پلن فعلی قابل‌خرید
    // است (نه همان پلن دوباره، نه پایین‌تر) — PAYG مستقل از این قانون است (مسیر مصرف جداست).
    const upgradeCreditToman = plan.isPayAsYouGo
      ? 0
      : await this.computeUpgradeCredit(userId, plan)

    // docs/PRD-growth-traction-features.md بخش ۵.۲ — کد تخفیف اختیاری
    let finalAmount = Math.max(0, plan.priceMonthly - upgradeCreditToman)
    let discountCodeId: string | null = null
    if (dto.discountCode) {
      const code = await this.discountCodeService.findValidCode(dto.discountCode, userId)
      discountCodeId = code.id
      finalAmount = Math.round(finalAmount * (1 - code.discountPercent / 100))
    }

    const gateway = this.registry.resolve(dto.gateway)
    // نکته: این باید آدرس خودِ بک‌اند باشد (API_URL)، نه فرانت (APP_URL) —
    // چون این آدرس رو مستقیم درگاه پرداخت صدا می‌زند. روی پروداکشن این دو دامنه‌ی متفاوتند
    // (nivoai.ir برای فرانت، api.nivoai.ir برای بک‌اند)؛ اگر اشتباه بشوند، callback درگاه
    // به SPA فرانت می‌خورد و به‌جای verify شدن، به‌خاطر catch-all روتر به صفحه‌ی اصلی می‌رود.
    const callbackUrl = `${this.config.get('API_URL')}/api/v1/payments/callback/${gateway.name.toLowerCase()}`

    this.logger.log(`initiate: gateway=${gateway.name} callbackUrl=${callbackUrl} finalAmount=${finalAmount}`)

    // مرز تبدیل: همه‌جای پروژه تومان است، ولی API درگاه‌های پرداخت (زرین‌پال/وندار/زیبال) فقط ریال قبول می‌کند
    const { providerRef, paymentUrl } = await gateway.createPayment({
      amount: finalAmount * 10,
      description: fa.payment.description(plan.name),
      callbackUrl,
    })

    // docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴ — source=app بعداً روی
    // ریدایرکت برگشتی verify() سوار می‌شود تا CallbackPage.tsx دکمه‌ی «بازگشت به اپ» نشان دهد
    const metadata: Prisma.InputJsonObject = {}
    if (upgradeCreditToman > 0) Object.assign(metadata, { isUpgrade: true, upgradeCreditToman })
    if (dto.source === 'app') Object.assign(metadata, { source: 'app' })

    await this.prisma.payment.create({
      data: {
        userId,
        planId: dto.planId,
        amount: finalAmount,
        provider: gateway.name,
        providerRef,
        ...(discountCodeId ? { discountCodeId } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
      },
    })

    this.logger.log(`initiate: created payment providerRef=${providerRef} paymentUrl=${paymentUrl}`)

    return { paymentUrl, providerRef }
  }

  // docs/PRD-plan-image-capability-and-upgrade.md بخش ۶.۲ — اگر کاربر یک سابسکریپشن معمولی
  // فعال دارد، فقط پلن گران‌تر قابل‌خرید است؛ اعتبار روزهای باقی‌مانده‌ی پلن فعلی از قیمت پلن
  // جدید کم می‌شود. چون این تابع فقط وقتی صدا زده می‌شود که newPlan.priceMonthly > oldPlan.priceMonthly
  // (پایین‌تر throw می‌شود)، اعتبار محاسبه‌شده همیشه کوچک‌تر از قیمت پلن جدید است — هیچ‌وقت پرداخت منفی نمی‌شود.
  private async computeUpgradeCredit(userId: string, newPlan: Plan): Promise<number> {
    const now = new Date()
    const currentSub = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    })
    if (!currentSub || currentSub.status !== 'ACTIVE' || currentSub.periodEnd <= now || currentSub.plan.isPayAsYouGo) {
      return 0
    }

    const currentPlan = currentSub.plan
    if (newPlan.priceMonthly <= currentPlan.priceMonthly) {
      throw new BadRequestException({
        message: fa.plans.downgradeOrRepurchaseNotAllowed(currentPlan.name),
        code: 'PLAN_DOWNGRADE_OR_REPURCHASE_NOT_ALLOWED',
      })
    }

    const totalMs = SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
    const remainingMs = Math.min(totalMs, Math.max(0, currentSub.periodEnd.getTime() - now.getTime()))
    return Math.round(currentPlan.priceMonthly * (remainingMs / totalMs))
  }

  getEnabledGateways() {
    return this.registry.getEnabled().map((g) => g.toLowerCase())
  }

  // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۱ — شارژ کیف‌پول، بدون planId (Payment.kind='WALLET_TOPUP')
  async initiateWalletTopup(userId: string, dto: InitiateWalletTopupDto) {
    const paygPlan = await this.prisma.plan.findFirst({ where: { isPayAsYouGo: true, isActive: true } })
    if (!paygPlan) throw new BadRequestException(fa.payAsYouGo.notConfigured)

    const priorTopups = await this.prisma.payment.count({
      where: { userId, kind: 'WALLET_TOPUP', status: 'COMPLETED' },
    })
    const minAmount = priorTopups === 0
      ? paygPlan.payAsYouGoMinActivationToman ?? 1_000_000
      : paygPlan.payAsYouGoMinTopupToman ?? 500_000
    if (dto.amountToman < minAmount) {
      throw new BadRequestException(
        priorTopups === 0 ? fa.payAsYouGo.minActivation(minAmount) : fa.payAsYouGo.minTopup(minAmount),
      )
    }

    const gateway = this.registry.resolve(dto.gateway)
    const callbackUrl = `${this.config.get('API_URL')}/api/v1/payments/callback/${gateway.name.toLowerCase()}`

    this.logger.log(`initiateWalletTopup: gateway=${gateway.name} amount=${dto.amountToman}`)

    const { providerRef, paymentUrl } = await gateway.createPayment({
      amount: dto.amountToman * 10, // مرز تبدیل تومان→ریال، مثل initiate()
      description: fa.payment.walletTopupDescription,
      callbackUrl,
    })

    await this.prisma.payment.create({
      data: {
        userId,
        kind: 'WALLET_TOPUP',
        planId: null,
        amount: dto.amountToman,
        provider: gateway.name,
        providerRef,
        ...(dto.source === 'app' ? { metadata: { source: 'app' } } : {}),
      },
    })

    return { paymentUrl, providerRef }
  }

  // برای دکمه‌ی «اعمال» کد تخفیف در صفحه‌ی قیمت‌گذاری — فقط اعتبارسنجی می‌کند، هیچ‌چیزی
  // مصرف/ثبت نمی‌شود (مصرف واقعی همچنان فقط داخل initiate/verify اتفاق می‌افتد)
  async validateDiscountCode(userId: string, code: string) {
    const found = await this.discountCodeService.findValidCode(code, userId)
    return { discountPercent: found.discountPercent }
  }

  async verifyCallback(providerName: string, query: Record<string, string>) {
    this.logger.log(`callback hit: provider=${providerName} query=${JSON.stringify(query)}`)

    const provider = providerName.toUpperCase() as PaymentProvider
    if (!this.registry.getEnabled().includes(provider)) {
      this.logger.warn(`callback: provider "${providerName}" not enabled/known — rejecting with 404`)
      throw new NotFoundException()
    }

    const gateway = this.registry.byName(provider)
    const { providerRef, success } = gateway.parseCallback(query)
    this.logger.log(`callback parsed: providerRef=${providerRef} callbackSuccess=${success}`)
    return this.verify(gateway, providerRef, success)
  }

  // docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴/۵.۵ — اگر initiate با source=app
  // صدا زده شده بود (متادیتای پرداخت آن را نگه داشته)، همان علامت روی هر ریدایرکت برگشتی هم سوار
  // می‌شود تا CallbackPage.tsx بتواند دکمه‌ی «بازگشت به اپ» را نشان دهد
  private withSourceParam(url: string, metadata: Prisma.JsonValue | null | undefined): string {
    const isFromApp = !!metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      && (metadata as Record<string, unknown>).source === 'app'
    return isFromApp ? `${url}&source=app` : url
  }

  private async verify(gateway: PaymentGateway, providerRef: string, callbackSuccess: boolean) {
    const appUrl = this.config.get<string>('APP_URL')

    if (!callbackSuccess) {
      const payment = await this.prisma.payment.findUnique({ where: { providerRef } })
      if (payment) {
        await this.prisma.payment.update({ where: { providerRef }, data: { status: 'FAILED' } })
      }
      this.logger.warn(`verify: callback reported failure for providerRef=${providerRef} (paymentFound=${!!payment})`)
      return { redirect: this.withSourceParam(`${appUrl}/payment?status=failed`, payment?.metadata) }
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerRef },
      include: { plan: true, user: true },
    })

    if (!payment) {
      this.logger.error(`verify: no Payment row found for providerRef=${providerRef} — was initiate() ever called for this?`)
      throw new NotFoundException(fa.payment.notFound)
    }
    this.logger.log(`verify: found payment id=${payment.id} status=${payment.status} amount=${payment.amount}`)

    if (payment.status === 'COMPLETED') {
      const invoice = await this.prisma.invoice.findUnique({ where: { paymentId: payment.id } })
      this.logger.log(`verify: already COMPLETED — idempotent redirect (invoiceId=${invoice?.id ?? 'none'})`)
      return { redirect: this.withSourceParam(`${appUrl}/payment?status=success&refId=${payment.refId}&invoiceId=${invoice?.id ?? ''}`, payment.metadata) }
    }
    if (payment.status !== 'PENDING') throw new BadRequestException(fa.payment.invalidStatus)

    // مرز تبدیل: payment.amount در دیتابیس تومان است؛ verify باید همان مبلغ ریالی اصلی createPayment را بدهد
    const { success, refId } = await gateway.verifyPayment({ amount: payment.amount * 10, providerRef })
    this.logger.log(`verify: gateway.verifyPayment result success=${success} refId=${refId}`)

    if (!success) {
      await this.prisma.payment.update({ where: { providerRef }, data: { status: 'FAILED' } })
      this.logger.warn(`verify: gateway verify failed for providerRef=${providerRef} — marked FAILED`)
      return { redirect: this.withSourceParam(`${appUrl}/payment?status=failed`, payment.metadata) }
    }

    if (payment.kind === 'WALLET_TOPUP') {
      return this.completeWalletTopup(payment, refId!, appUrl)
    }
    // از این‌جا به بعد فقط مسیر SUBSCRIPTION است — payment.plan طبق ساخت (بخش initiate بالا) همیشه ست است.
    // یک binding محلی جدید (نه فقط تصحیح در بلاک بالا) چون narrowing روی payment.plan داخل کلوژرِ
    // $transaction پایین‌تر نگه داشته نمی‌شود — یک const تازه لازم است.
    const plan = payment.plan
    if (!plan) {
      this.logger.error(`verify: SUBSCRIPTION payment ${payment.id} has no plan — data inconsistency`)
      throw new BadRequestException(fa.payment.notFound)
    }

    const now = new Date()
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000)

    // docs/PRD-growth-traction-features.md بخش ۶.۳ — پاداش معرفی فقط روی «اولین پرداخت موفق»
    // دوستِ معرفی‌شده فعال می‌شود؛ همین‌جا (قبل از تراکنش) چک می‌کنیم، نه بعدش، چون این پرداخت
    // هنوز PENDING است و شمارش COMPLETED قبلی‌ها را مخدوش نمی‌کند
    const isReferredUser = Boolean(payment.user.referredByUserId)
    const priorCompletedCount = isReferredUser
      ? await this.prisma.payment.count({ where: { userId: payment.userId, status: 'COMPLETED' } })
      : 0
    const isFirstCompletedPayment = priorCompletedCount === 0

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { providerRef },
        data: { status: 'COMPLETED', refId: refId! },
      })

      await tx.subscription.upsert({
        where: { userId: payment.userId },
        create: {
          userId: payment.userId,
          planId: plan.id,
          status: 'ACTIVE',
          periodStart: now,
          periodEnd,
          cancelAtPeriodEnd: false,
        },
        update: {
          planId: plan.id,
          status: 'ACTIVE',
          periodStart: now,
          periodEnd,
          cancelAtPeriodEnd: false,
        },
      })

      if (payment.discountCodeId) {
        await this.discountCodeService.recordRedemption(tx, payment.discountCodeId, payment.userId, payment.id)
      }

      return tx.invoice.create({
        data: {
          paymentId: payment.id,
          userId: payment.userId,
          planName: plan.name,
          amount: payment.amount,
          provider: payment.provider,
          refId: refId!,
          buyerName: payment.user.name,
          buyerPhone: payment.user.phone,
        },
      })
    })

    await this.tokenService.invalidatePlanCache(payment.userId)

    this.logger.log(`verify: payment COMPLETED, subscription activated, invoice ${invoice.id} created`)

    // نوتیف ادمین — docs/PRD-admin-notifications-and-mobile.md بخش ۴. فایر-اند-فورگت با catch،
    // دقیقاً مثل الگوی پاداش معرفی زیر — شکست نوتیف هرگز نباید پرداخت را fail کند
    this.adminNotifications
      .notify(
        'PAYMENT_COMPLETED',
        fa.adminNotification.paymentTitle,
        fa.adminNotification.paymentBody(plan.name, payment.amount, payment.user.phone),
        { paymentId: payment.id, userId: payment.userId, planName: plan.name, amount: payment.amount },
      )
      .catch((err) => this.logger.error(`admin notification failed for payment=${payment.id}`, err))

    // پاداش دوطرفه‌ی معرفی دوستان — بعد از تراکنش اصلی و غیربحرانی؛ شکستش نباید پرداخت رو fail کنه
    if (isReferredUser && isFirstCompletedPayment) {
      this.issueReferralRewards(payment.userId, payment.user.referredByUserId!).catch((err) =>
        this.logger.error(`referral reward issuance failed for payment=${payment.id}`, err),
      )
    }

    return { redirect: this.withSourceParam(`${appUrl}/payment?status=success&refId=${refId}&invoiceId=${invoice.id}`, payment.metadata) }
  }

  // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۱ — شارژ موفق: کیف‌پول credit می‌شود، و فقط اگر این
  // اولین شارژ موفق کاربر بوده باشد، اشتراکش به پلن PAYG سوییچ/فعال می‌شود
  private async completeWalletTopup(
    payment: Payment & { user: User },
    refId: string,
    appUrl: string | undefined,
  ) {
    const priorTopups = await this.prisma.payment.count({
      where: { userId: payment.userId, kind: 'WALLET_TOPUP', status: 'COMPLETED' },
    })
    const isFirstTopup = priorTopups === 0

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', refId },
      })

      const wallet = await tx.wallet.upsert({
        where: { userId: payment.userId },
        create: { userId: payment.userId, balanceToman: payment.amount },
        update: { balanceToman: { increment: payment.amount } },
      })
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amountToman: payment.amount,
          description: fa.payment.walletTopupDescription,
          metadata: { paymentId: payment.id },
        },
      })

      if (isFirstTopup) {
        const paygPlan = await tx.plan.findFirst({ where: { isPayAsYouGo: true, isActive: true } })
        if (paygPlan) {
          await tx.subscription.upsert({
            where: { userId: payment.userId },
            create: {
              userId: payment.userId,
              planId: paygPlan.id,
              status: 'ACTIVE',
              periodStart: new Date(),
              periodEnd: PAY_AS_YOU_GO_PERIOD_END,
              cancelAtPeriodEnd: false,
            },
            update: {
              planId: paygPlan.id,
              status: 'ACTIVE',
              periodStart: new Date(),
              periodEnd: PAY_AS_YOU_GO_PERIOD_END,
              cancelAtPeriodEnd: false,
            },
          })
        }
      }

      return tx.invoice.create({
        data: {
          paymentId: payment.id,
          userId: payment.userId,
          planName: null, // WALLET_TOPUP پلنی ندارد — invoice-pdf.service.ts در نبود planName برچسب «شارژ کیف‌پول» را نشان می‌دهد
          amount: payment.amount,
          provider: payment.provider,
          refId,
          buyerName: payment.user.name,
          buyerPhone: payment.user.phone,
        },
      })
    })

    await this.tokenService.invalidatePlanCache(payment.userId)
    this.logger.log(`completeWalletTopup: wallet credited ${payment.amount} for user=${payment.userId}, invoice=${invoice.id}`)

    this.adminNotifications
      .notify(
        'WALLET_TOPUP_COMPLETED',
        fa.adminNotification.walletTopupTitle,
        fa.adminNotification.walletTopupBody(payment.amount, payment.user.phone),
        { paymentId: payment.id, userId: payment.userId, amount: payment.amount },
      )
      .catch((err) => this.logger.error(`admin notification failed for wallet topup payment=${payment.id}`, err))

    return { redirect: this.withSourceParam(`${appUrl}/payment?status=success&refId=${refId}&invoiceId=${invoice.id}`, payment.metadata) }
  }

  private async issueReferralRewards(referredUserId: string, referrerUserId: string): Promise<void> {
    const config = await this.growthConfigService.getConfig()
    await Promise.all([
      this.discountCodeService.issuePersonalCode({
        userId: referredUserId,
        source: DiscountSource.REFERRAL,
        discountPercent: config.referralDiscountPercent,
        validDays: config.referralDiscountValidDays,
        dedupe: false,
      }),
      this.discountCodeService.issuePersonalCode({
        userId: referrerUserId,
        source: DiscountSource.REFERRAL,
        discountPercent: config.referralDiscountPercent,
        validDays: config.referralDiscountValidDays,
        dedupe: false,
      }),
    ])
  }

  findAll(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  getHistory(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
  }
}
