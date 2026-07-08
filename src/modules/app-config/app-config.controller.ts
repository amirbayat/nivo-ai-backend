import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Controller('config')
export class AppConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get('features')
  getFeatures() {
    return {
      showDailyBudget: this.config.get<string>('SHOW_DAILY_BUDGET', 'true') === 'true',
      showMonthlyTokenUsage: this.config.get<string>('SHOW_MONTHLY_TOKEN_USAGE', 'true') === 'true',
    }
  }
}
