import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const CACHE_KEY = 'topics:active';
const CACHE_TTL = 300;

interface TopicRule {
  id: string;
  keywords: string[];
}

interface TopicInput {
  name: string;
  keywords: string[];
  color?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * دسته‌بندی موضوعی پیام‌ها با heuristic کلیدواژه‌ای — بدون فراخوانی AI
 * (docs/PRD-global-budget-gateway.md بخش ۱۷.۴). دقت این روش برای گزارش‌گیری
 * تجمیعی/آماری کافی است؛ دقت پیام‌به‌پیام هدف این بخش نیست.
 */
@Injectable()
export class TopicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async classify(text: string): Promise<string | null> {
    if (!text) return null;
    const topics = await this.getActiveTopicRules();
    if (!topics.length) return null;

    const lower = text.toLowerCase();
    let best: { id: string; hits: number } | null = null;
    for (const topic of topics) {
      const hits = topic.keywords.reduce(
        (n, kw) => (kw && lower.includes(kw.toLowerCase()) ? n + 1 : n),
        0,
      );
      if (hits > 0 && (!best || hits > best.hits))
        best = { id: topic.id, hits };
    }
    return best?.id ?? null;
  }

  async list() {
    return this.prisma.topic.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async create(data: TopicInput) {
    const topic = await this.prisma.topic.create({ data });
    await this.invalidateCache();
    return topic;
  }

  async update(id: string, data: Partial<TopicInput>) {
    const topic = await this.prisma.topic.update({ where: { id }, data });
    await this.invalidateCache();
    return topic;
  }

  async remove(id: string) {
    await this.prisma.topic.delete({ where: { id } });
    await this.invalidateCache();
  }

  private async invalidateCache() {
    await this.redis.del(CACHE_KEY);
  }

  private async getActiveTopicRules(): Promise<TopicRule[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as TopicRule[];

    const topics = await this.prisma.topic.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, keywords: true },
    });
    const rules: TopicRule[] = topics.map((t) => ({
      id: t.id,
      keywords: t.keywords as string[],
    }));
    await this.redis.set(CACHE_KEY, JSON.stringify(rules), 'EX', CACHE_TTL);
    return rules;
  }
}
