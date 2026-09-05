import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { PricingService } from './pricing.service';
import { PricingTiersService } from './pricing-tiers.service';
import { AiModelRegistryService } from './ai-model-registry.service';
import { TokenEstimatorService } from './token-estimator.service';
import { UsageController } from './usage.controller';
import { PricingTiersController } from './pricing-tiers.controller';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';

@Module({
  imports: [ExchangeRateModule],
  controllers: [UsageController, PricingTiersController],
  providers: [
    TokenService,
    PricingService,
    PricingTiersService,
    AiModelRegistryService,
    TokenEstimatorService,
  ],
  exports: [
    TokenService,
    PricingService,
    PricingTiersService,
    AiModelRegistryService,
    TokenEstimatorService,
  ],
})
export class UsageModule {}
