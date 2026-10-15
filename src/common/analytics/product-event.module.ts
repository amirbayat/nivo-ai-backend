import { Global, Module } from '@nestjs/common';
import { ProductEventService } from './product-event.service';

@Global()
@Module({
  providers: [ProductEventService],
  exports: [ProductEventService],
})
export class ProductEventModule {}
