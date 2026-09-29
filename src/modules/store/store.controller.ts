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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { OrderStatus } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { StoreService } from './store.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-mvp-launch-plan.md گام ۰ — ثبت‌نام فروشنده و ساخت فروشگاه
@Controller('v2/stores')
@UseGuards(JwtGuard)
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

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
}
