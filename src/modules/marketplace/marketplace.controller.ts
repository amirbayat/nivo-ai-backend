import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { SendOtpDto } from '../auth/dto/send-otp.dto';
import { VerifyMarketplaceOtpDto } from './dto/verify-marketplace-otp.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-marketplace-explore-cross-store.md بخش ۷ (فاز ۵ MVP) — بدون JwtGuard: خریدار اینجا
// هیچ‌وقت یک User نیست، فقط یک توکن کوتاه‌مدت مخصوص «سفارش‌های من» دارد (MarketplaceService)
@Controller('v2/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('stores')
  listStores() {
    return this.marketplaceService.listActiveStores();
  }

  @Post('orders/send-otp')
  @HttpCode(200)
  sendOtp(@Body() dto: SendOtpDto) {
    return this.marketplaceService.sendOtp(dto.phone);
  }

  @Post('orders/verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyMarketplaceOtpDto) {
    return this.marketplaceService.verifyOtp(dto.phone, dto.code);
  }

  @Get('orders')
  getOrders(@Headers('authorization') authorization?: string) {
    if (!authorization) {
      throw new UnauthorizedException(fa.marketplace.invalidSession);
    }
    return this.marketplaceService.getOrdersForToken(authorization);
  }
}
