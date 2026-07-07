import { Module } from '@nestjs/common'
import { TokenService } from './token.service'
import { PricingService } from './pricing.service'
import { AiModelRegistryService } from './ai-model-registry.service'
import { TokenEstimatorService } from './token-estimator.service'
import { UsageController } from './usage.controller'
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module'

@Module({
  imports: [ExchangeRateModule],
  controllers: [UsageController],
  providers: [TokenService, PricingService, AiModelRegistryService, TokenEstimatorService],
  exports: [TokenService, PricingService, AiModelRegistryService, TokenEstimatorService],
})
export class UsageModule {}
