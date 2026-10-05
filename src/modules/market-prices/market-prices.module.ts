import { Module } from '@nestjs/common';
import { MarketPricesService } from './market-prices.service';
import { MarketPricesController } from './market-prices.controller';

@Module({
  controllers: [MarketPricesController],
  providers: [MarketPricesService],
  exports: [MarketPricesService],
})
export class MarketPricesModule {}
