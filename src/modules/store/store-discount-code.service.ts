import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-customer-comments-and-discounts.md بخش ب — مدیریت کد تخفیف فروشگاهی در پنل فروشنده
@Injectable()
export class StoreDiscountCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async list(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.storeDiscountCode.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(sellerId: string, storeId: string, dto: CreateDiscountCodeDto) {
    await this.storeService.getOwned(sellerId, storeId);
    const code = dto.code.trim().toUpperCase();
    if (dto.kind === 'PERCENT' && dto.value > 100) {
      throw new BadRequestException(fa.store.discountPercentTooHigh);
    }
    const existing = await this.prisma.storeDiscountCode.findUnique({
      where: { storeId_code: { storeId, code } },
    });
    if (existing) throw new ConflictException(fa.store.discountCodeTaken);
    return this.prisma.storeDiscountCode.create({
      data: {
        storeId,
        code,
        kind: dto.kind,
        value: dto.value,
        maxRedemptions: dto.maxRedemptions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        minQuantity: dto.minQuantity,
      },
    });
  }

  async update(
    sellerId: string,
    storeId: string,
    codeId: string,
    dto: UpdateDiscountCodeDto,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const discount = await this.prisma.storeDiscountCode.findUnique({
      where: { id: codeId },
    });
    if (!discount || discount.storeId !== storeId) {
      throw new NotFoundException(fa.store.discountCodeNotFound);
    }
    return this.prisma.storeDiscountCode.update({
      where: { id: codeId },
      data: dto,
    });
  }
}
