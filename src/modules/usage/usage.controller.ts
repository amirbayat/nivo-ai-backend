import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { TokenService } from './token.service'
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
    const [plan, todayCount] = await Promise.all([
      this.tokenService.getCachedPlan(user.sub),
      this.tokenService.getTodayRequestCount(user.sub),
    ])

    const N = plan.dailyMessageLimit
    const M = plan.throttledMessageCount ?? 0

    let stage: 'normal' | 'throttled' | 'blocked' = 'normal'
    if (N !== null) {
      if (todayCount >= N + M) stage = 'blocked'
      else if (todayCount >= N) stage = 'throttled'
    }

    // next midnight Iran time (UTC+3:30) converted back to UTC for the client
    const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000
    const iranNow = new Date(Date.now() + IRAN_OFFSET_MS)
    const iranMidnight = new Date(iranNow)
    iranMidnight.setUTCDate(iranMidnight.getUTCDate() + 1)
    iranMidnight.setUTCHours(0, 0, 0, 0)
    const resetAt = new Date(iranMidnight.getTime() - IRAN_OFFSET_MS)

    return {
      todayCount,
      N,
      M,
      stage,
      remainingNormal: N !== null ? Math.max(0, N - todayCount) : null,
      remainingThrottled: N !== null ? Math.max(0, N + M - todayCount) : null,
      throttledInputTokens: plan.throttledInputTokens,
      throttledOutputTokens: plan.throttledOutputTokens,
      resetAt: resetAt.toISOString(),
    }
  }
}
