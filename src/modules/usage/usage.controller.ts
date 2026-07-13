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
    // بنر محدودیت هم باید از دوره‌ی آزمایشی بی‌خبر نباشد — قبلاً مستقیم از plan.* می‌خواند
    // و در trial همچنان «محدودیت» نشون می‌داد در حالی که ارسال واقعی دیگر مسدود نبود
    const { inTrial, effectiveN, effectiveM, effectiveRollingLimit, effectiveRollingHours } =
      await this.tokenService.getEffectiveLimits(user.sub, plan)

    const [todayCount, rollingWindow, budgetStatus, tokenQuota] = await Promise.all([
      this.tokenService.getTodayRequestCount(user.sub),
      this.tokenService.getRollingWindowStatus(user.sub, {
        rollingWindowLimit: effectiveRollingLimit,
        rollingWindowHours: effectiveRollingHours,
      }),
      this.pricingService.getBudgetStatus(user.sub, plan.priceMonthly, plan.planTier),
      this.tokenService.getTokenQuotaStatus(user.sub, plan, inTrial),
    ])

    const N = effectiveN
    const M = effectiveM ?? 0

    let stage: 'normal' | 'throttled' | 'blocked' = 'normal'
    if (N !== null) {
      if (todayCount >= N + M) stage = 'blocked'
      else if (todayCount >= N) stage = 'throttled'
    }

    const budgetBlocked =
      !inTrial &&
      (budgetStatus.warningLevel === 'exceeded' ||
        (budgetStatus.warningLevel === 'session_limit' && budgetStatus.walletBalanceToman === 0))

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
      rollingWindow: effectiveRollingLimit !== null
        ? { blocked: rollingWindow.blocked, resetAt: rollingWindow.resetAt }
        : null,
      budget: {
        blocked: budgetBlocked,
        reason: budgetBlocked ? (budgetStatus.warningLevel === 'exceeded' ? 'exceeded' : 'session_limit') : null,
        resetAt: budgetStatus.resetAt,
      },
      tokenQuota,
    }
  }
}
