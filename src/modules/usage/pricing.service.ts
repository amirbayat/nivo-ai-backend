import { HttpException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service'
import { fa } from '../../i18n/fa'

export type BudgetWarningLevel = 'none' | 'warning' | 'critical' | 'session_limit' | 'exceeded'

export interface BudgetStatus {
  dailyBudgetRial: number
  spentTodayRial: number
  remainingTodayRial: number
  monthlyBudgetRial: number
  spentMonthRial: number
  walletBalanceRial: number
  warningLevel: BudgetWarningLevel
  cascadeModel: string | null
  upsellSuggestion: string | null
  usdtRial: number
}

interface ModelPrice {
  input: number  // USD per 1M tokens
  output: number
}

function dailyCostKey(userId: string) {
  const d = new Date().toISOString().slice(0, 10)
  return `cost:daily:${userId}:${d}`
}

function monthlyCostKey(userId: string) {
  const m = new Date().toISOString().slice(0, 7)
  return `cost:monthly:${userId}:${m}`
}

@Injectable()
export class PricingService {
  private readonly aiShare: number
  private readonly warnPct: number
  private readonly downgradePct: number
  private readonly sessionLimitPct: number
  private readonly freeBudgetRial: number
  private readonly walletMarkup: number
  private readonly modelPricing: Record<string, ModelPrice>

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly exchangeRate: ExchangeRateService,
  ) {
    this.aiShare = Number(this.config.get('AI_BUDGET_SHARE', '0.70'))
    this.warnPct = Number(this.config.get('BUDGET_WARN_PCT', '60')) / 100
    this.downgradePct = Number(this.config.get('BUDGET_DOWNGRADE_PCT', '80')) / 100
    this.sessionLimitPct = Number(this.config.get('BUDGET_SESSION_LIMIT_PCT', '90')) / 100
    this.freeBudgetRial = Number(this.config.get('FREE_PLAN_MONTHLY_BUDGET_RIAL', '50000'))
    this.walletMarkup = Number(this.config.get('WALLET_MARKUP', '1.667'))

    const p = (key: string, fallback: string) => Number(this.config.get(key, fallback))
    this.modelPricing = {
      'openai/gpt-4o-mini': { input: p('PRICE_GPT4O_MINI_INPUT', '0.15'), output: p('PRICE_GPT4O_MINI_OUTPUT', '0.60') },
      'openai/gpt-4o':      { input: p('PRICE_GPT4O_INPUT', '2.50'),      output: p('PRICE_GPT4O_OUTPUT', '10.00') },
      'openai/gpt-4-turbo': { input: p('PRICE_GPT4_TURBO_INPUT', '10.00'), output: p('PRICE_GPT4_TURBO_OUTPUT', '30.00') },
      'gpt-4o-mini': { input: p('PRICE_GPT4O_MINI_INPUT', '0.15'), output: p('PRICE_GPT4O_MINI_OUTPUT', '0.60') },
      'gpt-4o':      { input: p('PRICE_GPT4O_INPUT', '2.50'),      output: p('PRICE_GPT4O_OUTPUT', '10.00') },
    }
  }

  async calcCostRial(inputTokens: number, outputTokens: number, modelId: string): Promise<number> {
    const price = this.modelPricing[modelId] ?? { input: 0.15, output: 0.60 }
    const usdCost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    const rate = await this.exchangeRate.getUsdtRial()
    return Math.ceil(usdCost * rate)
  }

  async dailyBudgetRial(priceMonthly: number): Promise<number> {
    if (priceMonthly === 0) return Math.floor(this.freeBudgetRial / 30)
    return Math.floor((priceMonthly * this.aiShare) / 30)
  }

  async monthlyBudgetRial(priceMonthly: number): Promise<number> {
    if (priceMonthly === 0) return this.freeBudgetRial
    return Math.floor(priceMonthly * this.aiShare)
  }

  walletCostForRial(baseRial: number): number {
    return Math.ceil(baseRial * this.walletMarkup)
  }

  async trackCost(userId: string, costRial: number): Promise<void> {
    const dKey = dailyCostKey(userId)
    const mKey = monthlyCostKey(userId)
    await Promise.all([
      this.redis.incrby(dKey, costRial),
      this.redis.expire(dKey, 90_000, 'NX'),
      this.redis.incrby(mKey, costRial),
      this.redis.expire(mKey, 2_764_800, 'NX'),
    ])
  }

  async getSpentToday(userId: string): Promise<number> {
    return this.redis.get(dailyCostKey(userId)).then(v => Number(v) || 0)
  }

  async getSpentMonth(userId: string): Promise<number> {
    return this.redis.get(monthlyCostKey(userId)).then(v => Number(v) || 0)
  }

  async getBudgetStatus(userId: string, priceMonthly: number, planTier: string): Promise<BudgetStatus> {
    const [dailyBudget, monthlyBudget, usdtRial] = await Promise.all([
      this.dailyBudgetRial(priceMonthly),
      this.monthlyBudgetRial(priceMonthly),
      this.exchangeRate.getUsdtRial(),
    ])

    const [spentToday, spentMonth, wallet] = await Promise.all([
      this.getSpentToday(userId),
      this.getSpentMonth(userId),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balanceRial: true } }),
    ])

    const walletBalance = wallet?.balanceRial ?? 0
    const ratio = dailyBudget > 0 ? spentToday / dailyBudget : 0

    let warningLevel: BudgetWarningLevel = 'none'
    let cascadeModel: string | null = null
    let upsellSuggestion: string | null = null

    if (ratio >= 1) {
      warningLevel = walletBalance > 0 ? 'warning' : 'exceeded'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.sessionLimitPct) {
      warningLevel = 'session_limit'
      cascadeModel = 'openai/gpt-4o-mini'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.downgradePct) {
      warningLevel = 'critical'
      cascadeModel = 'openai/gpt-4o-mini'
      upsellSuggestion = this.upsellMessageFor(planTier)
    } else if (ratio >= this.warnPct) {
      warningLevel = 'warning'
    }

    return {
      dailyBudgetRial: dailyBudget,
      spentTodayRial: spentToday,
      remainingTodayRial: Math.max(0, dailyBudget - spentToday),
      monthlyBudgetRial: monthlyBudget,
      spentMonthRial: spentMonth,
      walletBalanceRial: walletBalance,
      warningLevel,
      cascadeModel,
      upsellSuggestion,
      usdtRial,
    }
  }

  async assertBudget(userId: string, priceMonthly: number, planTier: string): Promise<{ cascadeModel: string | null }> {
    const status = await this.getBudgetStatus(userId, priceMonthly, planTier)

    if (status.warningLevel === 'exceeded') {
      throw new HttpException(fa.chat.budgetExceeded, 429)
    }

    if (status.warningLevel === 'session_limit' && status.walletBalanceRial === 0) {
      throw new HttpException(fa.budget.sessionLimit, 429)
    }

    return { cascadeModel: status.cascadeModel }
  }

  async debitWallet(userId: string, costRial: number, description: string): Promise<boolean> {
    const walletCost = this.walletCostForRial(costRial)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } })
    if (!wallet || wallet.balanceRial < walletCost) return false

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: { balanceRial: { decrement: walletCost } },
      }),
      this.prisma.walletTransaction.create({
        data: { walletId: wallet.id, type: 'DEBIT', amountRial: walletCost, description },
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
