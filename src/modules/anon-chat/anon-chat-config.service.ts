import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AnonymousChatConfig } from '@prisma/client';
import type { UpdateAnonChatConfigDto } from './dto/update-anon-chat-config.dto';

const CACHE_TTL_MS = 60_000;

// singleton — همان الگوی ChatConfigService/SalesConfigService
@Injectable()
export class AnonChatConfigService {
  private cached: AnonymousChatConfig | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<AnonymousChatConfig> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const config = await this.prisma.anonymousChatConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(
    data: UpdateAnonChatConfigDto,
  ): Promise<AnonymousChatConfig> {
    const definedData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const config = await this.prisma.anonymousChatConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }
}
