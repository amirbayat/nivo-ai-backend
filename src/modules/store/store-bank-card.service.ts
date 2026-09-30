import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CardDisplayPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { CreateBankCardDto } from './dto/create-bank-card.dto';
import { UpdateBankCardDto } from './dto/update-bank-card.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-multi-bank-card-rotation.md بخش ۳ — مدیریت کارت‌های بانکی فروشگاه در پنل
@Injectable()
export class StoreBankCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async list(sellerId: string, storeId: string) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const cards = await this.prisma.storeBankCard.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
    });
    return { policy: store.cardDisplayPolicy, cards };
  }

  async create(sellerId: string, storeId: string, dto: CreateBankCardDto) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.storeBankCard.create({ data: { ...dto, storeId } });
  }

  private async getOwnedCard(
    sellerId: string,
    storeId: string,
    cardId: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const card = await this.prisma.storeBankCard.findUnique({
      where: { id: cardId },
    });
    if (!card || card.storeId !== storeId) {
      throw new NotFoundException(fa.store.bankCardNotFound);
    }
    return card;
  }

  async update(
    sellerId: string,
    storeId: string,
    cardId: string,
    dto: UpdateBankCardDto,
  ) {
    const card = await this.getOwnedCard(sellerId, storeId, cardId);
    // خریدار هیچ‌وقت نباید بدون کارت فعال بماند — بخش ۲ سند
    if (dto.isActive === false && card.isActive) {
      const otherActive = await this.prisma.storeBankCard.count({
        where: { storeId, isActive: true, id: { not: cardId } },
      });
      if (otherActive === 0) {
        throw new BadRequestException(fa.store.lastActiveBankCard);
      }
    }
    return this.prisma.storeBankCard.update({
      where: { id: cardId },
      data: dto,
    });
  }

  async updatePolicy(
    sellerId: string,
    storeId: string,
    policy: CardDisplayPolicy,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.store.update({
      where: { id: storeId },
      data: { cardDisplayPolicy: policy },
    });
  }
}
