import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { TokenService, nextIranMidnightISO } from './token.service'
import { PricingService } from './pricing.service'

@Controller('usage')
@UseGuards(JwtGuard)
export class UsageController {
  constructor(
    private readonly tokenService: TokenService,
    private readonly pricingService: PricingService,
  ) {}

  @Get('today')
  getToday(@CurrentUser() user: JwtPayload) {
    return this.tokenService.getUsageToday(user.sub)
  }

  @Get('history')
  getHistory(@CurrentUser() user: JwtPayload, @Query('month') month?: string) {
    return this.tokenService.getUsageHistory(user.sub, month)
  }

  @Get('budget')
  async getBudget(@CurrentUser() user: JwtPayload) {
    const plan = await this.tokenService.getCachedPlan(user.sub)
    return this.pricingService.getBudgetStatus(user.sub, plan.priceMonthly, plan.planTier)
  }

  @Get('message-quota')
  async getMessageQuota(@CurrentUser() user: JwtPayload) {
    const plan = await this.tokenService.getCachedPlan(user.sub)
    const [todayCount, rollingWindow, budgetStatus] = await Promise.all([
      this.tokenService.getTodayRequestCount(user.sub),
      this.tokenService.getRollingWindowStatus(user.sub, plan),
      this.pricingService.getBudgetStatus(user.sub, plan.priceMonthly, plan.planTier),
    ])

    const N = plan.dailyMessageLimit
    const M = plan.throttledMessageCount ?? 0

    let stage: 'normal' | 'throttled' | 'blocked' = 'normal'
    if (N !== null) {
      if (todayCount >= N + M) stage = 'blocked'
      else if (todayCount >= N) stage = 'throttled'
    }

    const budgetBlocked =
      budgetStatus.warningLevel === 'exceeded' ||
      (budgetStatus.warningLevel === 'session_limit' && budgetStatus.walletBalanceToman === 0)

    return {
      todayCount,
      N,
      M,
      stage,
      remainingNormal: N !== null ? Math.max(0, N - todayCount) : null,
      remainingThrottled: N !== null ? Math.max(0, N + M - todayCount) : null,
      throttledInputTokens: plan.throttledInputTokens,
      throttledOutputTokens: plan.throttledOutputTokens,
      resetAt: nextIranMidnightISO(),
      planTier: plan.planTier,
      rollingWindow: plan.rollingWindowLimit !== null
        ? { blocked: rollingWindow.blocked, resetAt: rollingWindow.resetAt }
        : null,
      budget: {
        blocked: budgetBlocked,
        reason: budgetBlocked ? (budgetStatus.warningLevel === 'exceeded' ? 'exceeded' : 'session_limit') : null,
        resetAt: budgetStatus.resetAt,
      },
    }
  }
}
