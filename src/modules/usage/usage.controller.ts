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
}
