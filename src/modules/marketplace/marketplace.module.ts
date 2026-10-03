import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { SmsModule } from '../../sms/sms.module';

@Module({
  imports: [JwtModule.register({}), SmsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
