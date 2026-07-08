import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentProvider } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { TokenService } from '../usage/token.service'
import { PaymentGatewayRegistry } from './gateways/payment-gateway.registry'
import { PaymentGateway } from './gateways/payment-gateway.interface'
import { fa } from '../../i18n/fa'
import { InitiatePaymentDto } from './dto/initiate-payment.dto'

const SUBSCRIPTION_DAYS = 30

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentGatewayRegistry,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  async initiate(userId: string, dto: InitiatePaymentDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } })
    if (!plan) throw new NotFoundException(fa.plans.notFound)
    if (!plan.isActive) throw new BadRequestException(fa.plans.notActive)

    const gateway = this.registry.resolve(dto.gateway)
    // نکته: این باید آدرس خودِ بک‌اند باشد (API_URL)، نه فرانت (APP_URL) —
    // چون این آدرس رو مستقیم درگاه پرداخت صدا می‌زند. روی پروداکشن این دو دامنه‌ی متفاوتند
    // (nivoai.ir برای فرانت، api.nivoai.ir برای بک‌اند)؛ اگر اشتباه بشوند، callback درگاه
    // به SPA فرانت می‌خورد و به‌جای verify شدن، به‌خاطر catch-all روتر به صفحه‌ی اصلی می‌رود.
    const callbackUrl = `${this.config.get('API_URL')}/api/v1/payments/callback/${gateway.name.toLowerCase()}`

    this.logger.log(`initiate: gateway=${gateway.name} callbackUrl=${callbackUrl}`)

    const { providerRef, paymentUrl } = await gateway.createPayment({
      amount: plan.priceMonthly,
      description: fa.payment.description(plan.name),
      callbackUrl,
    })

    await this.prisma.payment.create({
      data: { userId, planId: dto.planId, amount: plan.priceMonthly, provider: gateway.name, providerRef },
    })

    this.logger.log(`initiate: created payment providerRef=${providerRef} paymentUrl=${paymentUrl}`)

    return { paymentUrl, providerRef }
  }

  getEnabledGateways() {
    return this.registry.getEnabled().map((g) => g.toLowerCase())
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

  private async verify(gateway: PaymentGateway, providerRef: string, callbackSuccess: boolean) {
    const appUrl = this.config.get<string>('APP_URL')

    if (!callbackSuccess) {
      const payment = await this.prisma.payment.findUnique({ where: { providerRef } })
      if (payment) {
        await this.prisma.payment.update({ where: { providerRef }, data: { status: 'FAILED' } })
      }
      this.logger.warn(`verify: callback reported failure for providerRef=${providerRef} (paymentFound=${!!payment})`)
      return { redirect: `${appUrl}/payment?status=failed` }
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
      return { redirect: `${appUrl}/payment?status=success&refId=${payment.refId}&invoiceId=${invoice?.id ?? ''}` }
    }
    if (payment.status !== 'PENDING') throw new BadRequestException(fa.payment.invalidStatus)

    const { success, refId } = await gateway.verifyPayment({ amount: payment.amount, providerRef })
    this.logger.log(`verify: gateway.verifyPayment result success=${success} refId=${refId}`)

    if (!success) {
      await this.prisma.payment.update({ where: { providerRef }, data: { status: 'FAILED' } })
      this.logger.warn(`verify: gateway verify failed for providerRef=${providerRef} — marked FAILED`)
      return { redirect: `${appUrl}/payment?status=failed` }
    }

    const now = new Date()
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000)

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { providerRef },
        data: { status: 'COMPLETED', refId: refId! },
      })

      await tx.subscription.upsert({
        where: { userId: payment.userId },
        create: {
          userId: payment.userId,
          planId: payment.planId,
          status: 'ACTIVE',
          periodStart: now,
          periodEnd,
          cancelAtPeriodEnd: false,
        },
        update: {
          planId: payment.planId,
          status: 'ACTIVE',
          periodStart: now,
          periodEnd,
          cancelAtPeriodEnd: false,
        },
      })

      return tx.invoice.create({
        data: {
          paymentId: payment.id,
          userId: payment.userId,
          planName: payment.plan.name,
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

    return { redirect: `${appUrl}/payment?status=success&refId=${refId}&invoiceId=${invoice.id}` }
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
