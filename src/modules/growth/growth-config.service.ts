import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { GrowthConfig } from '@prisma/client';

const CACHE_TTL_MS = 60_000;

export type UpdatableGrowthConfig = Partial<
  Pick<
    GrowthConfig,
    | 'welcomeDiscountPercent'
    | 'welcomeDiscountValidHours'
    | 'expiryDiscountPercent'
    | 'referralDiscountPercent'
    | 'referralDiscountValidDays'
    | 'postTrialGraceHours'
  >
>;

// تک نقطه‌ی دسترسی به GrowthConfig (singleton) — دقیقاً الگوی ChatConfigService/SalesConfigService
@Injectable()
export class GrowthConfigService {
  private cached: GrowthConfig | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<GrowthConfig> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const config = await this.prisma.growthConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(data: UpdatableGrowthConfig): Promise<GrowthConfig> {
    const definedData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const config = await this.prisma.growthConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }
}
