import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService, StoreKbService],
  exports: [StoreService, StoreKbService],
})
export class StoreModule {}
