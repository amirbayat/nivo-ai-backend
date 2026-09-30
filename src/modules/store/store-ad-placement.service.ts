import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-advertising-placements.md بخش ۳/۴ — دو بازه‌ی زمانی ثابت با قیمت ثابت،
// عمداً بدون مزایده؛ خرید مستقیم از Store.creditBalanceToman، نه یک تراکنش پرداخت جدا
const PRICE_TIERS: { durationDays: 7 | 30; priceToman: number }[] = [
  { durationDays: 7, priceToman: 300_000 },
  { durationDays: 30, priceToman: 990_000 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StoreAdPlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async getStatus(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    const active = await this.prisma.adPlacement.findFirst({
      where: {
        storeId,
        placement: 'TELEGRAM_STORE_SEARCH',
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
      orderBy: { endsAt: 'desc' },
    });
    return { active, priceTiers: PRICE_TIERS };
  }

  // docs/PRD-seller-advertising-placements.md بخش ۴ — اگر جایگاه فعالی از قبل هست، خرید جدید
  // از انتهای همان بازه ادامه می‌خورد (نه از الان، تا زمان خریداری‌شده هدر نرود)
  async purchase(sellerId: string, storeId: string, durationDays: 7 | 30) {
    await this.storeService.getOwned(sellerId, storeId);
    const tier = PRICE_TIERS.find((t) => t.durationDays === durationDays);
    if (!tier) throw new BadRequestException(fa.validation.required);

    return this.prisma.$transaction(async (tx) => {
      const debited = await tx.store.updateMany({
        where: { id: storeId, creditBalanceToman: { gte: tier.priceToman } },
        data: { creditBalanceToman: { decrement: tier.priceToman } },
      });
      if (debited.count === 0) {
        throw new BadRequestException(fa.store.adPlacementInsufficientBalance);
      }

      const current = await tx.adPlacement.findFirst({
        where: {
          storeId,
          placement: 'TELEGRAM_STORE_SEARCH',
          status: 'ACTIVE',
          endsAt: { gt: new Date() },
        },
        orderBy: { endsAt: 'desc' },
      });
      const startsAt = current ? current.endsAt : new Date();
      const endsAt = new Date(startsAt.getTime() + tier.durationDays * DAY_MS);

      const placement = await tx.adPlacement.create({
        data: {
          storeId,
          placement: 'TELEGRAM_STORE_SEARCH',
          startsAt,
          endsAt,
          priceToman: tier.priceToman,
        },
      });

      await tx.creditUsageEvent.create({
        data: {
          storeId,
          model: 'n/a',
          kind: 'AD_PLACEMENT',
          costToman: tier.priceToman,
          isFreeQuota: false,
        },
      });

      return placement;
    });
  }
}
