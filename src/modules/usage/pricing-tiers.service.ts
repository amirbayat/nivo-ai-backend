import { Injectable } from '@nestjs/common';
import { PricingGenerationType, type PricingTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_TTL_MS = 60_000;

export type UpdatablePricingTier = Pick<
  PricingTier,
  'type' | 'minToman' | 'markup'
> & { maxToman?: number | null };

/**
 * جایگزین Plan.payAsYouGoMarkup ثابت قبلی (۱.۳) — برای متن/عکس/ویدیو یک جدول پله‌ای
 * جداگانه (بازه‌ی هزینه‌ی واقعی تومانی → ضریب)، کاملاً از ادمین قابل CRUD.
 * docs: پلن «ضریب پله‌ای قیمت‌گذاری» — کش ۶۰ ثانیه‌ای چون به‌ازای هر تراکنش خوانده می‌شود.
 */
@Injectable()
export class PricingTiersService {
  private cached: PricingTier[] | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  private async getAllTiers(): Promise<PricingTier[]> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const tiers = await this.prisma.pricingTier.findMany({
      orderBy: { minToman: 'asc' },
    });
    this.cached = tiers;
    this.cachedAt = now;
    return tiers;
  }

  private invalidateCache(): void {
    this.cached = null;
    this.cachedAt = 0;
  }

  // اگر هیچ پله‌ای برای این نوع تعریف نشده باشد، fallback به ۱ (بدون ضریب) — نه throw،
  // چون قطع‌شدن مسیر پرداخت به‌خاطر تنظیمات ناقص ادمین قابل قبول نیست.
  async getMarkup(
    type: PricingGenerationType,
    costToman: number,
  ): Promise<number> {
    const tiers = (await this.getAllTiers()).filter((t) => t.type === type);
    const match = tiers.find(
      (t) =>
        costToman >= t.minToman &&
        (t.maxToman === null || costToman < t.maxToman),
    );
    return match?.markup ?? 1;
  }

  async listTiers(type?: PricingGenerationType): Promise<PricingTier[]> {
    const tiers = await this.getAllTiers();
    return type ? tiers.filter((t) => t.type === type) : tiers;
  }

  async createTier(data: UpdatablePricingTier): Promise<PricingTier> {
    const tier = await this.prisma.pricingTier.create({ data });
    this.invalidateCache();
    return tier;
  }

  async updateTier(
    id: string,
    data: Partial<UpdatablePricingTier>,
  ): Promise<PricingTier> {
    const tier = await this.prisma.pricingTier.update({ where: { id }, data });
    this.invalidateCache();
    return tier;
  }

  async deleteTier(id: string): Promise<void> {
    await this.prisma.pricingTier.delete({ where: { id } });
    this.invalidateCache();
  }
}
