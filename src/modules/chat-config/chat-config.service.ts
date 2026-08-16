import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, type ChatConfig } from '@prisma/client';

const CACHE_TTL_MS = 60_000;

export type UpdatableChatConfig = Partial<
  Pick<
    ChatConfig,
    | 'globalContextMd'
    | 'summaryTriggerTokens'
    | 'summaryMaxTokens'
    | 'maxImagesPerMessage'
    | 'maxImageSizeMb'
    | 'implicitImageGenEnabled'
  >
> & { allowedImageFormats?: string[] };

/**
 * تک نقطه‌ی دسترسی به ChatConfig (singleton) — هم برای مسیر چت اصلی (روی هر پیام صدا زده
 * می‌شود) هم برای پنل ادمین. کش کوتاه‌مدت درون‌حافظه‌ای، دقیقاً الگوی SalesConfigService
 * (docs/PRD-chat-context-and-summarization.md بخش ۴.۲).
 */
@Injectable()
export class ChatConfigService {
  private cached: ChatConfig | null = null;
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<ChatConfig> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached;

    const config = await this.prisma.chatConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(data: UpdatableChatConfig): Promise<ChatConfig> {
    // dto class fields با مقدار undefined هم به‌صورت key صریح روی instance ست می‌شوند،
    // پس قبل از spread حذف می‌شوند وگرنه مقادیر پیش‌فرض create را با undefined بازنویسی می‌کنند
    const { allowedImageFormats, ...rest } = data;
    const definedData: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    if (allowedImageFormats !== undefined) {
      definedData.allowedImageFormats = allowedImageFormats;
    }

    const config = await this.prisma.chatConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...definedData },
      update: definedData,
    });

    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }
}
