import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { OnboardingGift } from '@prisma/client';

const CACHE_TTL_MS = 60_000;

export type UpdatableOnboardingGift = Partial<
  Pick<OnboardingGift, 'title' | 'description' | 'audioUrl' | 'isActive'>
>;

// تک نقطه‌ی دسترسی به OnboardingGift (singleton) — همون الگوی GrowthConfigService/ChatConfigService
@Injectable()
export class OnboardingGiftService {
  private cached: OnboardingGift | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getGift(): Promise<OnboardingGift> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const gift = await this.prisma.onboardingGift.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = gift;
    this.cachedAt = now;
    return gift;
  }

  async updateGift(data: UpdatableOnboardingGift): Promise<OnboardingGift> {
    const definedData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const gift = await this.prisma.onboardingGift.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = gift;
    this.cachedAt = Date.now();
    return gift;
  }
}
