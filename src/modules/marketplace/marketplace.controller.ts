import { Controller, Get, UseGuards } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';

@Controller('v2/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('stores')
  listStores() {
    return this.marketplaceService.listActiveStores();
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۴.۲ — خریدار از
  // /auth/send-otp + /auth/verify-otp عمومی لاگین می‌کند (همان مسیر فروشنده)، نه یک
  // OTP/توکن مخصوص این صفحه
  @Get('orders')
  @UseGuards(JwtGuard)
  getMyOrders(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getMyOrders(user.phone);
  }
}
