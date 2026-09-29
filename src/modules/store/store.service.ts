import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { fa } from '../../i18n/fa';

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  list(sellerId: string) {
    return this.prisma.store.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { products: true },
    });
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.prisma.store.findUnique({ where: { slug } });
    return !existing;
  }

  async create(sellerId: string, dto: CreateStoreDto) {
    if (!(await this.isSlugAvailable(dto.slug))) {
      throw new ConflictException(fa.store.slugTaken);
    }
    return this.prisma.store.create({ data: { ...dto, sellerId } });
  }

  // مالکیت را چک می‌کند (۴۰۴/۴۰۳ مناسب پرتاب می‌کند) — الگوی ProjectsService.get
  async getOwned(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException(fa.store.notFound);
    if (store.sellerId !== sellerId)
      throw new ForbiddenException(fa.store.forbidden);
    return store;
  }

  async createProduct(
    sellerId: string,
    storeId: string,
    dto: CreateProductDto,
  ) {
    await this.getOwned(sellerId, storeId);
    return this.prisma.product.create({ data: { ...dto, storeId } });
  }

  // docs/PRD-mvp-launch-plan.md گام ۱ — حداقلی، بدون UI: فروشنده باید بتواند سفارش‌های
  // در انتظار تایید را ببیند/تایید/رد کند تا حلقه‌ی سفارش با curl قابل تست باشد؛ صف کامل
  // با نمایش تصویر رسید در پنل موبایل، گام ۳ است.
  async listOrders(sellerId: string, storeId: string, status?: OrderStatus) {
    await this.getOwned(sellerId, storeId);
    return this.prisma.order.findMany({
      where: { storeId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getOwnedOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
  ) {
    await this.getOwned(sellerId, storeId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.storeId !== storeId)
      throw new NotFoundException(fa.salesAgent.orderNotFound);
    return order;
  }

  async approveOrder(sellerId: string, storeId: string, orderId: string) {
    await this.getOwnedOrder(sellerId, storeId, orderId);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'APPROVED' },
    });
  }

  async rejectOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    reason?: string,
  ) {
    await this.getOwnedOrder(sellerId, storeId, orderId);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'REJECTED', rejectReason: reason },
    });
  }
}
