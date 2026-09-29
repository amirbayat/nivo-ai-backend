import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { StoreService } from './store.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';

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
}
