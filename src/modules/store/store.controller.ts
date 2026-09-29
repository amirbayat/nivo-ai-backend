import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
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
}
