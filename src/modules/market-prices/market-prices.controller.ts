import { Controller, Get } from '@nestjs/common';
import { MarketPricesService } from './market-prices.service';

@Controller('market-prices')
export class MarketPricesController {
  constructor(private readonly marketPrices: MarketPricesService) {}

  @Get('gold')
  getGold() {
    return this.marketPrices.getGoldPrices();
  }
}
