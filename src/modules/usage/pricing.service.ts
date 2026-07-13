import { HttpException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service'
import { AiModelRegistryService } from './ai-model-registry.service'
import { fa } from '../../i18n/fa'

export type BudgetWarningLevel = 'none' | 'warning' | 'critical' | 'session_limit' | 'exceeded'

export interface BudgetStatus {
  dailyBudgetToman: number
  spentTodayToman: number
  remainingTodayToman: number
  monthlyBudgetToman: number
  spentMonthToman: number
  walletBalanceToman: number
  warningLevel: BudgetWarningLevel
  usagePct: number
  upsellSuggestion: string | null
  usdtToman: number
  resetAt: string
}

// dailyCostKey از تاریخ UTC استفاده می‌کند (نه ساعت ایران مثل token.service) —
// یعنی بودجه‌ی روزانه واقعاً در نیمه‌شب UTC (۰۳:۳۰ به‌وقت ایران) ریست می‌شود، نه نیمه‌شب ایران.
function nextUtcMidnightISO(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toISOString()
}

function dailyCostKey(userId: string) {
  const d = new Date().toISOString().slice(0, 10)
  return `cost:daily:${userId}:${d}`
}

function monthlyCostKey(userId: string) {
  const m = new Date().toISOString().slice(0, 7)
  return `cost:monthly:${userId}:${m}`
}

function dailyCostUsdKey(userId: string) {
  const d = new Date().toISOString().slice(0, 10)
  return `cost_usd:daily:${userId}:${d}`
}

export interface CostCalc {
  costToman: number
  costUsdMicros: number // دلار × ۱٬۰۰۰٬۰۰۰ — نگه‌داشتن هزینه‌ی خام دلاری برای آنالیز مستقل از نوسان نرخ ارز
  costInputUsdMicros: number // سهم توکن ورودی از costUsdMicros — برای میانگین وزنی قیمت ورودی/خروجی
  costOutputUsdMicros: number
}

@Injectable()
export class PricingService {
  private readonly aiShare: number
  private readonly warnPct: number
  private readonly downgradePct: number
  private readonly sessionLimitPct: number
  private readonly freeBudgetToman: number
  private readonly walletMarkup: number

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly modelRegistry: AiModelRegistryService,
  ) {
    this.aiShare = Number(this.config.get('AI_BUDGET_SHARE', '0.70'))
    this.warnPct = Number(this.config.get('BUDGET_WARN_PCT', '60')) / 100
    this.downgradePct = Number(this.config.get('BUDGET_DOWNGRADE_PCT', '80')) / 100
    this.sessionLimitPct = Number(this.config.get('BUDGET_SESSION_LIMIT_PCT', '90')) / 100
    this.freeBudgetToman = Number(this.config.get('FREE_PLAN_MONTHLY_BUDGET_TOMAN', '5000'))
    this.walletMarkup = Number(this.config.get('WALLET_MARKUP', '1.667'))
  }

  // قیمت هر مدل از AiModel (پنل ادمین) خوانده می‌شود، نه یک نگاشت هاردکد —
  // مدلی که در جدول نباشد دیگر بی‌صدا با قیمت gpt-4o-mini حساب نمی‌شود
  // (docs/PRD-global-budget-gateway.md بخش ۹.۳). هزینه‌ی خام دلاری هم برگردانده
  // می‌شود تا حسابداری آنالیز مصرف (بخش ۱۷.۵) مستقل از نوسان نرخ لحظه‌ای بماند.
  async calcCost(inputTokens: number, outputTokens: number, modelId: string): Promise<CostCalc> {
    const price = await this.modelRegistry.getModelInfo(modelId)
    const inputUsdCost = (inputTokens * price.inputPricePerM) / 1_000_000
    const outputUsdCost = (outputTokens * price.outputPricePerM) / 1_000_000
    const usdCost = inputUsdCost + outputUsdCost
    const rate = await this.exchangeRate.getUsdtToman()
    return {
      costToman: Math.ceil(usdCost * rate),
      costUsdMicros: Math.round(usdCost * 1_000_000),
      costInputUsdMicros: Math.round(inputUsdCost * 1_000_000),
      costOutputUsdMicros: Math.round(outputUsdCost * 1_000_000),
    }
  }

  async dailyBudgetToman(priceMonthly: number): Promise<number> {
    if (priceMonthly === 0) return Math.floor(this.freeBudgetToman / 30)
    return Math.floor((priceMonthly * this.aiShare) / 30)
  }

  async monthlyBudgetToman(priceMonthly: number): Promise<number> {
    if (priceMonthly === 0) return this.freeBudgetToman
    return Math.floor(priceMonthly * this.aiShare)
  }

  walletCostForToman(baseToman: number): number {
    return Math.ceil(baseToman * this.walletMarkup)
  }

  async trackCost(userId: string, costToman: number, costUsdMicros = 0): Promise<void> {
    const dKey = dailyCostKey(userId)
    const mKey = monthlyCostKey(userId)
    const dUsdKey = dailyCostUsdKey(userId)
    await Promise.all([
      this.redis.incrby(dKey, costToman),
      this.redis.expire(dKey, 90_000, 'NX'),
      this.redis.incrby(mKey, costToman),
      this.redis.expire(mKey, 2_764_800, 'NX'),
      this.redis.incrby(dUsdKey, costUsdMicros),
      this.redis.expire(dUsdKey, 90_000, 'NX'),
    ])
  }

  async getSpentToday(userId: string): Promise<number> {
    return this.redis.get(dailyCostKey(userId)).then(v => Number(v) || 0)
  }

  async getSpentMonth(userId: string): Promise<number> {
    return this.redis.get(monthlyCostKey(userId)).then(v => Number(v) || 0)
  }

  async getBudgetStatus(userId: string, priceMonthly: number, planTier: string): Promise<BudgetStatus> {
    const [dailyBudget, monthlyBudget, usdtToman] = await Promise.all([
      this.dailyBudgetToman(priceMonthly),
      this.monthlyBudgetToman(priceMonthly),
      this.exchangeRate.getUsdtToman(),
    ])

    const [spentToday, spentMonth, wallet] = await Promise.all([
      this.getSpentToday(userId),
      this.getSpentMonth(userId),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balanceToman: true } }),
    ])

    const walletBalance = wallet?.balanceToman ?? 0
    const ratio = dailyBudget > 0 ? spentToday / dailyBudget : 0

    let warningLevel: BudgetWarningLevel = 'none'
    let upsellSuggestion: string | null = null

    if (ratio >= 1) {
      warningLevel = walletBalance > 0 ? 'warning' : 'exceeded'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.sessionLimitPct) {
      warningLevel = 'session_limit'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.downgradePct) {
      warningLevel = 'critical'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.warnPct) {
      warningLevel = 'warning'
    }

    return {
      dailyBudgetToman: dailyBudget,
      spentTodayToman: spentToday,
      remainingTodayToman: Math.max(0, dailyBudget - spentToday),
      monthlyBudgetToman: monthlyBudget,
      spentMonthToman: spentMonth,
      walletBalanceToman: walletBalance,
      warningLevel,
      usagePct: Math.round(ratio * 100),
      upsellSuggestion,
      usdtToman,
      resetAt: nextUtcMidnightISO(),
    }
  }

  // usagePct از اینجا به ModelRouterService پاس داده می‌شود تا استپ مسیریابی بودجه‌ای پلن را تعیین کند
  // (docs/PRD-model-router.md) — دیگر یک مدل کسکید ثابت این‌جا انتخاب نمی‌شود، آن مسئولیت کامل به Router منتقل شده
  async assertBudget(userId: string, priceMonthly: number, planTier: string): Promise<{ usagePct: number }> {
    const status = await this.getBudgetStatus(userId, priceMonthly, planTier)

    if (status.warningLevel === 'exceeded') {
      throw new HttpException(
        { message: fa.chat.budgetExceeded, stage: 'budget_exceeded', planTier, resetAt: status.resetAt },
        429,
      )
    }

    if (status.warningLevel === 'session_limit' && status.walletBalanceToman === 0) {
      throw new HttpException(
        { message: fa.budget.sessionLimit, stage: 'budget_session_limit', planTier, resetAt: status.resetAt },
        429,
      )
    }

    return { usagePct: status.usagePct }
  }

  async debitWallet(userId: string, costToman: number, description: string): Promise<boolean> {
    const walletCost = this.walletCostForToman(costToman)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } })
    if (!wallet || wallet.balanceToman < walletCost) return false

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: { balanceToman: { decrement: walletCost } },
      }),
      this.prisma.walletTransaction.create({
        data: { walletId: wallet.id, type: 'DEBIT', amountToman: walletCost, description },
      }),
    ])
    return true
  }

  private upsellMessageFor(planTier: string): string {
    if (planTier === 'free') return fa.upsell.free
    if (planTier === 'pro') return fa.upsell.pro
    return fa.upsell.premium
  }
}
