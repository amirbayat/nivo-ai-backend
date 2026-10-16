import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { onStoreContentChanged } from './store-content-changed';
import type { CardDisplayPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { CreateBankCardDto } from './dto/create-bank-card.dto';
import { UpdateBankCardDto } from './dto/update-bank-card.dto';
import { ProductEventService } from '../../common/analytics/product-event.service';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-multi-bank-card-rotation.md بخش ۳ — مدیریت کارت‌های بانکی فروشگاه در پنل
@Injectable()
export class StoreBankCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly productEvents: ProductEventService,
  ) {}

  async list(sellerId: string, storeId: string) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const cards = await this.prisma.storeBankCard.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
    });
    return { policy: store.cardDisplayPolicy, cards };
  }

  async create(...args: Parameters<StoreBankCardService['createImpl']>) {
    const result = await this.createImpl(...args);
    onStoreContentChanged(args[1]);
    return result;
  }

  private async createImpl(sellerId: string, storeId: string, dto: CreateBankCardDto) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const hadMethod =
      !!store.snapppayPaymentLink ||
      !!(store.bankCardNumber && store.bankOwnerName) ||
      (await this.prisma.storeBankCard.count({ where: { storeId } })) > 0;
    const card = await this.prisma.storeBankCard.create({ data: { ...dto, storeId } });
    if (!hadMethod) {
      this.productEvents.log('payment_method_added', { storeId, userId: sellerId }, { kind: 'card' });
    }
    return card;
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

  async update(...args: Parameters<StoreBankCardService['updateImpl']>) {
    const result = await this.updateImpl(...args);
    onStoreContentChanged(args[1]);
    return result;
  }

  private async updateImpl(
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
