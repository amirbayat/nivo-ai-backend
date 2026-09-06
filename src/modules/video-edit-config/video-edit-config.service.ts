import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { type VideoEditConfig } from '@prisma/client';

const CACHE_TTL_MS = 60_000;

export type UpdatableVideoEditConfig = Partial<
  Pick<
    VideoEditConfig,
    | 'isEnabled'
    | 'generateFixedDurationSec'
    | 'maxConcurrentJobsPerUser'
    | 'maxJobsPerDayPerUser'
  >
>;

// تک نقطه‌ی دسترسی به VideoEditConfig (سینگلتون) — دقیقاً الگوی VideoStudioConfigService
@Injectable()
export class VideoEditConfigService {
  private cached: VideoEditConfig | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<VideoEditConfig> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const config = await this.prisma.videoEditConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(data: UpdatableVideoEditConfig): Promise<VideoEditConfig> {
    const definedData: Record<string, unknown> = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const config = await this.prisma.videoEditConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }
}
