import { Injectable } from '@nestjs/common';
import type { CaptionPricingTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_TTL_MS = 60_000;

export type UpdatableCaptionPricingTier = Pick<CaptionPricingTier, 'creditCost'> & {
  maxDurationSec?: number | null;
  sortOrder?: number;
};

// دقیقاً هم‌الگوی PricingTiersService — با این تفاوت که پله‌ها بر اساس طول ویدیو (ثانیه) است،
// نه هزینه‌ی واقعی تومانی (docs/PRD-video-auto-captions.md §۱۴.۲/۱۴.۳: قیمت‌گذاری این فیچر
// عمداً cost-based نیست، چون هزینه‌ی واقعی ASR ناچیز است و ارزش واقعی فیچر را منعکس نمی‌کند).
@Injectable()
export class CaptionPricingService {
  private cached: CaptionPricingTier[] | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  private async getAllTiers(): Promise<CaptionPricingTier[]> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const tiers = await this.prisma.captionPricingTier.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    this.cached = tiers;
    this.cachedAt = now;
    return tiers;
  }

  private invalidateCache(): void {
    this.cached = null;
    this.cachedAt = 0;
  }

  // اولین پله‌ای که durationSec در آن جا می‌شود (maxDurationSec=null یعنی بدون سقف، آخرین
  // پله‌ی باز). اگر ادمین اصلاً پله‌ای تعریف نکرده باشد throw می‌کنیم — برخلاف
  // PricingTiersService.getMarkup (fallback امن به ۱×)، اینجا fallback ارزان برای یک ویدیوی
  // بلند یک باگ واقعی قیمت‌گذاری است، نه یک مقدار امن (بخش ۱۴.۳)
  async getCreditCost(durationSec: number): Promise<number> {
    const tiers = await this.getAllTiers();
    const match = tiers.find(
      (t) => t.maxDurationSec === null || durationSec <= t.maxDurationSec,
    );
    if (!match) {
      throw new Error(
        'no CaptionPricingTier configured — ادمین باید حداقل یک پله (ترجیحاً یک ردیف باز maxDurationSec=null) تعریف کند',
      );
    }
    return match.creditCost;
  }

  async listTiers(): Promise<CaptionPricingTier[]> {
    return this.getAllTiers();
  }

  async createTier(data: UpdatableCaptionPricingTier): Promise<CaptionPricingTier> {
    const tier = await this.prisma.captionPricingTier.create({ data });
    this.invalidateCache();
    return tier;
  }

  async updateTier(
    id: string,
    data: Partial<UpdatableCaptionPricingTier>,
  ): Promise<CaptionPricingTier> {
    const tier = await this.prisma.captionPricingTier.update({ where: { id }, data });
    this.invalidateCache();
    return tier;
  }

  async deleteTier(id: string): Promise<void> {
    await this.prisma.captionPricingTier.delete({ where: { id } });
    this.invalidateCache();
  }
}
