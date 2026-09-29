import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException(fa.store.notFound);
    if (store.sellerId !== sellerId) throw new ForbiddenException(fa.store.forbidden);
    return store;
  }

  async createProduct(sellerId: string, storeId: string, dto: CreateProductDto) {
    await this.getOwned(sellerId, storeId);
    return this.prisma.product.create({ data: { ...dto, storeId } });
  }
}
