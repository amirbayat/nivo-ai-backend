import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PricingGenerationType } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PricingTiersService } from './pricing-tiers.service';
import { CreatePricingTierDto } from './dto/create-pricing-tier.dto';
import { UpdatePricingTierDto } from './dto/update-pricing-tier.dto';

@Controller('admin/pricing-tiers')
@UseGuards(JwtGuard, AdminGuard)
export class PricingTiersController {
  constructor(private readonly pricingTiers: PricingTiersService) {}

  @Get()
  list(@Query('type') type?: PricingGenerationType) {
    return this.pricingTiers.listTiers(type);
  }

  @Post()
  create(@Body() dto: CreatePricingTierDto) {
    return this.pricingTiers.createTier(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePricingTierDto) {
    return this.pricingTiers.updateTier(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pricingTiers.deleteTier(id);
  }
}
