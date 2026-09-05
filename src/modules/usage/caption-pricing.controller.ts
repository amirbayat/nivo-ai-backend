import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CaptionPricingService } from './caption-pricing.service';
import { CreateCaptionPricingTierDto } from './dto/create-caption-pricing-tier.dto';
import { UpdateCaptionPricingTierDto } from './dto/update-caption-pricing-tier.dto';

// docs/PRD-video-auto-captions.md §۱۴.۳/§۱۸ — جدول پله‌های «تا X ثانیه Y نیوو»، کاملاً
// CRUD از پنل ادمین (CaptionPricingPage.tsx)
@Controller('admin/caption-pricing-tiers')
@UseGuards(JwtGuard, AdminGuard)
export class CaptionPricingController {
  constructor(private readonly captionPricing: CaptionPricingService) {}

  @Get()
  list() {
    return this.captionPricing.listTiers();
  }

  @Post()
  create(@Body() dto: CreateCaptionPricingTierDto) {
    return this.captionPricing.createTier(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCaptionPricingTierDto) {
    return this.captionPricing.updateTier(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.captionPricing.deleteTier(id);
  }
}
