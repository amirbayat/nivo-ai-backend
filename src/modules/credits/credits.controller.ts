import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CreditPackageScope } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { CreditsService } from './credits.service';
import { PurchaseCreditPackageDto } from './dto/purchase-credit-package.dto';
import { ConfirmBazaarPurchaseDto } from './dto/confirm-bazaar-purchase.dto';

// v2 — endpoint های جدید نیوو، مستقل از plan.isPayAsYouGo (بخش ۵.۲ سند فنی)
@Controller('v2/credits')
@UseGuards(JwtGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('balance')
  getBalance(@CurrentUser() user: JwtPayload) {
    return this.creditsService.getBalance(user.sub);
  }

  // برای کارت «مبلغ دلخواه» — قیمت زنده (debounce شده توی فرانت) هر تعداد نیوو دلخواه
  @Get('quote')
  quote(
    @Query('credits') credits: string,
    @Query('scope') scope?: CreditPackageScope,
  ) {
    return this.creditsService.quoteCustomPrice(Number(credits), scope);
  }

  @Post('purchase')
  purchase(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PurchaseCreditPackageDto,
  ) {
    return this.creditsService.purchasePackage(user.sub, dto);
  }

  // تایید خرید انجام‌شده از طریق پرداخت درون‌برنامه‌ای کافه‌بازار (اپ اندروید نیوو کال)
  @Post('purchase/bazaar/confirm')
  confirmBazaarPurchase(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmBazaarPurchaseDto,
  ) {
    return this.creditsService.confirmBazaarPurchase(user.sub, dto);
  }
}
