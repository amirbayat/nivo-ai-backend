import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { CreditsService } from './credits.service';
import { PurchaseCreditPackageDto } from './dto/purchase-credit-package.dto';

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
  quote(@Query('credits') credits: string) {
    return this.creditsService.quoteCustomPrice(Number(credits));
  }

  @Post('purchase')
  purchase(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PurchaseCreditPackageDto,
  ) {
    return this.creditsService.purchasePackage(user.sub, dto);
  }
}
