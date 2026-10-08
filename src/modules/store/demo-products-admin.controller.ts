import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۲۰.۳ — روی Darkube هیچ
// shell/ترمینالی داخل کانتینر بک‌اند پروداکشن در دسترس نیست، پس عکس/فیلم محصولات قالب دمو
// فقط از همین مسیر (پشت همون ApiKeyGuard که content-agent استفاده می‌کند) قابل‌اتصال است.
// محدود به isDemoTemplate=true (داخل StoreService.getDemoTemplateProduct) — محصول واقعی
// یک فروشنده هیچ‌وقت از این کنترلر قابل‌دسترس نیست، حتی با همین کلید
@Controller('admin/demo-products')
@UseGuards(ApiKeyGuard)
export class DemoProductsAdminController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  list() {
    return this.storeService.listDemoTemplateProducts();
  }

  @Post(':productId/image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  addImage(
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    return this.storeService.addDemoProductImage(productId, file);
  }

  @Post(':productId/video')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 55 * 1024 * 1024 } }),
  )
  addVideo(
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    return this.storeService.addDemoProductVideo(productId, file);
  }
}
