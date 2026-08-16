import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiscountSource } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { GrowthConfigService } from './growth-config.service';
import { OnboardingGiftService } from './onboarding-gift.service';
import { DiscountCodeService } from './discount-code.service';
import { UpdateGrowthConfigDto } from './dto/update-growth-config.dto';
import { UpdateOnboardingGiftDto } from './dto/update-onboarding-gift.dto';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';

@Controller('admin/growth')
@UseGuards(JwtGuard, AdminGuard)
export class GrowthAdminController {
  constructor(
    private readonly growthConfig: GrowthConfigService,
    private readonly onboardingGift: OnboardingGiftService,
    private readonly discountCode: DiscountCodeService,
  ) {}

  @Get('config')
  getConfig() {
    return this.growthConfig.getConfig();
  }

  @Patch('config')
  updateConfig(@Body() dto: UpdateGrowthConfigDto) {
    return this.growthConfig.updateConfig(dto);
  }

  @Get('onboarding-gift')
  getGift() {
    return this.onboardingGift.getGift();
  }

  @Patch('onboarding-gift')
  updateGift(@Body() dto: UpdateOnboardingGiftDto) {
    return this.onboardingGift.updateGift(dto);
  }

  @Get('discount-codes')
  listCodes(@Query('source') source?: DiscountSource) {
    return this.discountCode.listCodes(source);
  }

  @Post('discount-codes')
  createCode(@Body() dto: CreateDiscountCodeDto) {
    return this.discountCode.createManualCode(dto);
  }

  @Patch('discount-codes/:id/active')
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.discountCode.setActive(id, isActive);
  }
}
