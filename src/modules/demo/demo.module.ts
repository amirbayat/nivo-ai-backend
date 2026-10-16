import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { StoreModule } from '../store/store.module';
import { DemoService } from './demo.service';

@Module({
  imports: [StoreModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
