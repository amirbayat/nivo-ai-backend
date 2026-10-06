import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { InstagramController } from './instagram.controller';
import { InstagramSellerController } from './instagram-seller.controller';
import { InstagramIntlSellerController } from './instagram-intl-seller.controller';
import { InstagramService } from './instagram.service';
import { InstagramApiClientService } from './instagram-api-client.service';

@Module({
  // StoreModule — برای StoreService.getOwned در مسیر ایرانی (بخش ۴.۴). IntlJwtGuard به
  // IntlAuthModule احتیاج ندارد — دقیقاً مثل JwtGuard/AuthModule (passport strategy یک‌بار در
  // app.module.ts ساخته و global ثبت می‌شود، همین که آن ماژول در گراف اپ import شده باشد کافی‌ست)
  imports: [StoreModule],
  controllers: [
    InstagramController,
    InstagramSellerController,
    InstagramIntlSellerController,
  ],
  providers: [InstagramService, InstagramApiClientService],
  exports: [InstagramService],
})
export class InstagramModule {}
