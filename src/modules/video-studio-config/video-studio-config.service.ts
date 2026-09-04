import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { type VideoStudioConfig } from '@prisma/client';

const CACHE_TTL_MS = 60_000;

export type UpdatableVideoStudioConfig = Partial<
  Pick<
    VideoStudioConfig,
    | 'characterOptionCount'
    | 'maxCharacterRegeneratesPerProject'
    | 'maxConcurrentVideoJobsPerUser'
    | 'maxVideoGenPerDayPerUser'
    | 'defaultAudioEnabled'
  >
>;

/**
 * تک نقطه‌ی دسترسی به VideoStudioConfig (سینگلتون) — دقیقاً الگوی ChatConfigService.
 * characterOptionCount عمداً DB-backed/ادمین-قابل‌تغییر است (نه هاردکد ۴) — طبق تصمیم صریح
 * کاربر (docs/PRD-video-studio-chat-flow.md)، چون مستقیم روی هزینه‌ی هر پروژه اثر می‌گذارد.
 */
@Injectable()
export class VideoStudioConfigService {
  private cached: VideoStudioConfig | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<VideoStudioConfig> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const config = await this.prisma.videoStudioConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(
    data: UpdatableVideoStudioConfig,
  ): Promise<VideoStudioConfig> {
    const definedData: Record<string, unknown> = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const config = await this.prisma.videoStudioConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }
}
