import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { OrderStatus } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import type { StoreKbKind } from '@prisma/client';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { StoreCreditService } from './store-credit.service';
import { StoreBankCardService } from './store-bank-card.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ImportProductFromUrlDto } from './dto/import-product-from-url.dto';
import { AddProductImagesFromUrlDto } from './dto/add-product-images-from-url.dto';
import { CreateKbEntryDto } from './dto/create-kb-entry.dto';
import { UpdateKbEntryDto } from './dto/update-kb-entry.dto';
import { PurchaseStoreCreditDto } from './dto/purchase-store-credit.dto';
import { CreateBankCardDto } from './dto/create-bank-card.dto';
import { UpdateBankCardDto } from './dto/update-bank-card.dto';
import { UpdateCardPolicyDto } from './dto/update-card-policy.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-mvp-launch-plan.md گام ۰ — ثبت‌نام فروشنده و ساخت فروشگاه
@Controller('v2/stores')
@UseGuards(JwtGuard)
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly storeKbService: StoreKbService,
    private readonly storeCreditService: StoreCreditService,
    private readonly storeBankCardService: StoreBankCardService,
  ) {}

  @Get('me')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.storeService.list(user.sub);
  }

  @Get('slug-available')
  async slugAvailable(@Query('slug') slug: string) {
    return { available: await this.storeService.isSlugAvailable(slug) };
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateStoreDto) {
    return this.storeService.create(user.sub, dto);
  }

  @Post(':id/products')
  createProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.storeService.createProduct(user.sub, id, dto);
  }

  @Get(':id/products')
  listProducts(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeService.listProducts(user.sub, id);
  }

  @Patch(':id/products/:productId')
  updateProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.storeService.updateProduct(user.sub, id, productId, dto);
  }

  @Delete(':id/products/:productId')
  deleteProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.storeService.deleteProduct(user.sub, id, productId);
  }

  // فیدبک اول پایلوت — آپلود عکس محصول (حداکثر ۴ تا، هرکدام تا ۵ مگابایت)
  @Post(':id/products/:productId/images')
  @UseInterceptors(
    FilesInterceptor('files', 4, { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  addProductImages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.storeService.addProductImages(
      user.sub,
      id,
      productId,
      files ?? [],
    );
  }

  @Delete(':id/products/:productId/images/:key')
  removeProductImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Param('key') key: string,
  ) {
    return this.storeService.removeProductImage(user.sub, id, productId, key);
  }

  // docs/PRD-seller-knowledge-base.md بخش ۲.۵ — فقط پیش‌نمایش؛ افزودن واقعی با همین
  // POST :id/products موجود انجام می‌شود (فروشنده در فرم فیلدهای پرشده را تأیید می‌کند)
  @Post(':id/products/import-from-url')
  importProductFromUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ImportProductFromUrlDto,
  ) {
    return this.storeKbService.importProductFromUrl(user.sub, id, dto.url);
  }

  @Post(':id/products/:productId/images/from-url')
  addProductImagesFromUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: AddProductImagesFromUrlDto,
  ) {
    return this.storeService.addProductImagesFromUrl(
      user.sub,
      id,
      productId,
      dto.urls,
    );
  }

  @Post(':id/products/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  importProducts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.store.noFileUploaded);
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException(fa.store.excelOnly);
    }
    return this.storeService.importProducts(user.sub, id, file.buffer);
  }

  @Get(':id/orders')
  listOrders(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('status') status?: OrderStatus,
  ) {
    return this.storeService.listOrders(user.sub, id, status);
  }

  @Post(':id/orders/:orderId/approve')
  approveOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
  ) {
    return this.storeService.approveOrder(user.sub, id, orderId);
  }

  @Post(':id/orders/:orderId/reject')
  rejectOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Body('reason') reason?: string,
  ) {
    return this.storeService.rejectOrder(user.sub, id, orderId, reason);
  }

  // مثل conversations.controller.ts getImage — SkipThrottle چون filename/orderId قابل
  // حدس‌زدن تصادفی نیست و مالکیت در سرویس چک می‌شود
  @SkipThrottle()
  @Get(':id/orders/:orderId/receipt-image')
  async getReceiptImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.storeService.getReceiptImage(
      user.sub,
      id,
      orderId,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buffer);
  }

  @Get(':id/conversations')
  listNeededAttention(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.storeService.listNeededAttention(user.sub, id);
  }

  @Get(':id/conversations/:conversationId')
  getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.storeService.getConversation(user.sub, id, conversationId);
  }

  @Post(':id/conversations/:conversationId/messages')
  sendSellerMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Body('text') text: string,
  ) {
    return this.storeService.sendSellerMessage(
      user.sub,
      id,
      conversationId,
      text,
    );
  }

  @Post(':id/conversations/:conversationId/unmute')
  unmuteConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.storeService.unmuteConversation(user.sub, id, conversationId);
  }

  // دستیار تکمیل محصول با AI (docs/PRD-seller-knowledge-base.md بخش ۲/۲.۳)
  @Post(':id/products/:productId/ai-complete')
  completeProductInfo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Query('withWebSearch') withWebSearch?: string,
  ) {
    return this.storeKbService.completeProductInfo(
      user.sub,
      id,
      productId,
      withWebSearch === 'true',
    );
  }

  // باکس دانش فروشگاه (بخش ۳)
  @Get(':id/knowledge')
  listKb(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('kind') kind?: StoreKbKind,
  ) {
    return this.storeKbService.list(user.sub, id, kind);
  }

  @Post(':id/knowledge')
  createKb(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateKbEntryDto,
  ) {
    return this.storeKbService.create(user.sub, id, dto);
  }

  @Patch(':id/knowledge/:entryId')
  updateKb(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateKbEntryDto,
  ) {
    return this.storeKbService.update(user.sub, id, entryId, dto);
  }

  @Delete(':id/knowledge/:entryId')
  removeKb(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    return this.storeKbService.remove(user.sub, id, entryId);
  }

  // آپلود فایل → استخراج کاندیدها (ذخیره نمی‌شود — فروشنده باید هرکدام را تأیید کند، بخش ۳.۳)
  @Post(':id/knowledge/extract-file')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  extractKbFile(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.store.noFileUploaded);
    return this.storeKbService.extractCandidatesFromFile(user.sub, id, file);
  }

  // docs/PRD-seller-credit-billing.md بخش ۷ — موجودی اعتبار AI + سهمیه‌ی رایگان امروز
  @Get(':id/credit')
  getCreditStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeCreditService.getStatus(user.sub, id);
  }

  // خرید self-serve یک بسته‌ی اعتبار — از همان درگاه پرداخت واقعی موجود
  @Post(':id/credit/purchase')
  purchaseCredit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PurchaseStoreCreditDto,
  ) {
    return this.storeCreditService.purchase(
      user.sub,
      id,
      dto.packageId,
      dto.gateway,
    );
  }

  // docs/PRD-seller-multi-bank-card-rotation.md — چند کارت + سیاست چرخشی نمایش
  @Get(':id/bank-cards')
  listBankCards(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeBankCardService.list(user.sub, id);
  }

  @Post(':id/bank-cards')
  createBankCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateBankCardDto,
  ) {
    return this.storeBankCardService.create(user.sub, id, dto);
  }

  @Patch(':id/bank-cards/:cardId')
  updateBankCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('cardId') cardId: string,
    @Body() dto: UpdateBankCardDto,
  ) {
    return this.storeBankCardService.update(user.sub, id, cardId, dto);
  }

  @Patch(':id/card-policy')
  updateCardPolicy(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCardPolicyDto,
  ) {
    return this.storeBankCardService.updatePolicy(user.sub, id, dto.policy);
  }
}
