import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { PricingService } from './pricing.service';
import { PricingTiersService } from './pricing-tiers.service';
import { CaptionPricingService } from './caption-pricing.service';
import { AiModelRegistryService } from './ai-model-registry.service';
import { TokenEstimatorService } from './token-estimator.service';
import { UsageController } from './usage.controller';
import { PricingTiersController } from './pricing-tiers.controller';
import { CaptionPricingController } from './caption-pricing.controller';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';

@Module({
  imports: [ExchangeRateModule],
  controllers: [UsageController, PricingTiersController, CaptionPricingController],
  providers: [
    TokenService,
    PricingService,
    PricingTiersService,
    CaptionPricingService,
    AiModelRegistryService,
    TokenEstimatorService,
  ],
  exports: [
    TokenService,
    PricingService,
    PricingTiersService,
    CaptionPricingService,
    AiModelRegistryService,
    TokenEstimatorService,
  ],
})
export class UsageModule {}
