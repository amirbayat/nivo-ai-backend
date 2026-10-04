import { Module } from '@nestjs/common';
import { AdminStoreCreditController } from './admin-store-credit.controller';
import { AdminStoreCreditService } from './admin-store-credit.service';

@Module({
  controllers: [AdminStoreCreditController],
  providers: [AdminStoreCreditService],
})
export class AdminStoreCreditModule {}
