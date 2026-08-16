import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { GrowthConfigService } from './growth-config.service';
import { OnboardingGiftService } from './onboarding-gift.service';
import { DiscountCodeService } from './discount-code.service';
import { GrowthPublicController } from './growth-public.controller';
import { GrowthAdminController } from './growth-admin.controller';

@Module({
  imports: [UsageModule],
  controllers: [GrowthPublicController, GrowthAdminController],
  providers: [GrowthConfigService, OnboardingGiftService, DiscountCodeService],
  exports: [GrowthConfigService, OnboardingGiftService, DiscountCodeService],
})
export class GrowthModule {}
