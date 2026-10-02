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
import { StoreDiscountCodeService } from './store-discount-code.service';
import { StoreAdPlacementService } from './store-ad-placement.service';
import { ProductEnrichmentService } from './product-enrichment.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
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
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { PurchaseAdPlacementDto } from './dto/purchase-ad-placement.dto';
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
    private readonly storeDiscountCodeService: StoreDiscountCodeService,
    private readonly storeAdPlacementService: StoreAdPlacementService,
    private readonly productEnrichmentService: ProductEnrichmentService,
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

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — ویرایش فیلدهای ساختاریافته‌ی فروشگاه
  // بعد از ثبت‌نام (ارسال/مرجوعی/معرفی برند/ساعت پاسخ‌گویی)
  @Patch(':id')
  updateStore(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.storeService.update(user.sub, id, dto);
  }

  // بخش ۳.۱ — امتیاز کلی تکمیل‌بودن فروشگاه + چک‌لیست، برای کارت «خانه»‌ی پنل
  @Get(':id/completeness')
  getCompleteness(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeService.getCompleteness(user.sub, id);
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

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۴ — عکس پروفایل فروشگاه (یک فایل، نه آرایه)
  @Post(':id/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadStoreLogo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    return this.storeService.uploadStoreLogo(user.sub, id, file);
  }

  @Delete(':id/logo')
  removeStoreLogo(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeService.removeStoreLogo(user.sub, id);
  }

  // docs/PRD-product-display-focus-and-variations.md §۲.۴ — کد کوتاه لینک تلگرامی این
  // محصول را برمی‌گرداند (در صورت نبود، همین‌جا می‌سازد)؛ فرانت خودش لینک کامل
  // https://t.me/<bot>?start=p_<shortCode> را می‌سازد
  @Post(':id/products/:productId/telegram-link')
  getProductTelegramLink(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.storeService.getProductTelegramLink(user.sub, id, productId);
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

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — میکروفون کنار توضیحات محصول در فرم فروشنده (ProductSheet)؛
  // عمداً زیر productId نیست چون موقع ساخت محصول جدید هنوز productId وجود ندارد
  @Post(':id/transcribe')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  transcribeDescription(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    return this.storeKbService.transcribeDescription(user.sub, id, file);
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

  // docs/PRD-sales-agent-admin-analytics.md بخش ۴ — مقایسه‌ی نرخ تبدیل وب/تلگرام همین فروشگاه
  @Get(':id/channel-stats')
  getChannelStats(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeService.getChannelStats(user.sub, id);
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — لینک اتصال یک‌بارمصرف تلگرام شخصی فروشنده
  @Post(':id/telegram-connect-token')
  createTelegramConnectToken(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.storeService.createTelegramConnectToken(user.sub, id);
  }

  // docs/PRD-seller-credit-billing.md بخش ۷ — موجودی اعتبار AI + سهمیه‌ی رایگان امروز
  @Get(':id/credit')
  getCreditStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeCreditService.getStatus(user.sub, id);
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — بسته‌های عمومی + مخصوص همین فروشگاه (برخلاف مسیر عمومی
  // v2/credits/packages که فقط بسته‌های عمومی را می‌بیند، چون storeId ندارد)
  @Get(':id/credit/packages')
  listCreditPackages(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeCreditService.listPackages(user.sub, id);
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

  // docs/PRD-customer-comments-and-discounts.md بخش ۸ — مدیریت کد تخفیف فروشگاهی
  @Get(':id/discount-codes')
  listDiscountCodes(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.storeDiscountCodeService.list(user.sub, id);
  }

  @Post(':id/discount-codes')
  createDiscountCode(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateDiscountCodeDto,
  ) {
    return this.storeDiscountCodeService.create(user.sub, id, dto);
  }

  @Patch(':id/discount-codes/:codeId')
  updateDiscountCode(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @Body() dto: UpdateDiscountCodeDto,
  ) {
    return this.storeDiscountCodeService.update(user.sub, id, codeId, dto);
  }

  // docs/PRD-seller-advertising-placements.md بخش ۴ — وضعیت فعلی + لیست بازه‌های قیمتی ثابت
  @Get(':id/ad-placement')
  getAdPlacementStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.storeAdPlacementService.getStatus(user.sub, id);
  }

  @Post(':id/ad-placement/purchase')
  purchaseAdPlacement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PurchaseAdPlacementDto,
  ) {
    return this.storeAdPlacementService.purchase(
      user.sub,
      id,
      dto.durationDays,
    );
  }

  // docs/PRD-product-display-focus-and-variations.md §۳ — جایگاه فاز ۲: نمایش یک محصول
  // مشخص در اولین پیام مکالمه؛ مسیر مجزا از ad-placement سطح-فروشگاه بالا، نه discriminator
  // روی همان endpoint، چون دو مفهوم محصولی متفاوتند
  @Get(':id/products/:productId/ad-placement')
  getProductAdPlacementStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.storeAdPlacementService.getProductStatus(
      user.sub,
      id,
      productId,
    );
  }

  @Post(':id/products/:productId/ad-placement/purchase')
  purchaseProductAdPlacement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: PurchaseAdPlacementDto,
  ) {
    return this.storeAdPlacementService.purchaseProductPlacement(
      user.sub,
      id,
      productId,
      dto.durationDays,
    );
  }

  // docs/PRD-admin-product-enrichment-review.md — پیش‌نویس تایید‌شده‌ی ادمین در انتظار
  // تصمیم فروشنده برای این محصول (یا null اگر چیزی در انتظار نیست)
  @Get(':id/products/:productId/enrichment-draft')
  getPendingEnrichmentDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.productEnrichmentService.sellerGetPendingDraft(
      user.sub,
      id,
      productId,
    );
  }

  @Post(':id/products/:productId/enrichment-draft/approve')
  approveEnrichmentDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.productEnrichmentService.sellerApproveDraft(
      user.sub,
      id,
      productId,
    );
  }

  @Post(':id/products/:productId/enrichment-draft/reject')
  rejectEnrichmentDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.productEnrichmentService.sellerRejectDraft(
      user.sub,
      id,
      productId,
    );
  }
}
