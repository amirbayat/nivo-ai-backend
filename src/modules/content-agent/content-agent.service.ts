import { BadRequestException, Injectable } from '@nestjs/common';
import { CreativeSegment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticlesService } from '../articles/articles.service';
import { CreateAgentArticleDto } from './dto/create-agent-article.dto';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';

// docs/PRD-daily-content-prompt-agent.md بخش ۵ — تحقیق/تایید قبلاً روی سیستم کاربر (Claude)
// اتفاق افتاده؛ این سرویس فقط چیزی را که از قبل تاییدشده می‌رسد در جدول‌های موجود ثبت می‌کند.
// خواندن عمومی endpoint جدا لازم نیست: پرامپت‌های AGENT_DISCOVERED همان ردیف‌های
// CreativePrompt هستند، پس همان GET /v2/discovery/catalog و GET /v2/discovery/catalog/:id
// موجود (discovery-public.controller.ts) با فیلتر sourceType آن‌ها را هم برمی‌گرداند —
// فرانت (/prompts و «امتحان کن») از همان مسیر تست‌شده‌ی /studio?id=... استفاده می‌کند.
@Injectable()
export class ContentAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly articlesService: ArticlesService,
  ) {}

  // ─── گام ۳ سند: ingest — پشت ApiKeyGuard ────────────────────────────────────
  async createAgentArticle(dto: CreateAgentArticleDto) {
    let categoryId: string | undefined;
    if (dto.categorySlug) {
      const category = await this.prisma.articleCategory.findUnique({
        where: { slug: dto.categorySlug },
      });
      if (!category) {
        throw new BadRequestException(
          `دسته‌بندی با اسلاگ «${dto.categorySlug}» پیدا نشد`,
        );
      }
      categoryId = category.id;
    }

    const article = await this.articlesService.createArticle({
      title: dto.title,
      contentMd: dto.summaryMd,
      categoryId,
      status: dto.publishNow ? 'PUBLISHED' : 'DRAFT',
    });

    return this.prisma.article.update({
      where: { id: article.id },
      data: {
        isAgentGenerated: true,
        agentSourceUrls: [{ url: dto.sourceUrl, name: dto.sourceName }],
      },
    });
  }

  // بدون رندر داخلی (تصمیم کاربر) — همان عکس نمونه‌ای که Claude کنار پرامپت در منبع پیدا
  // کرده مستقیم exampleImageUrl می‌شود؛ تایید انسانی از قبل در چت اتفاق افتاده پس بلافاصله فعال است
  async createAgentPrompt(dto: CreateAgentPromptDto) {
    const category = await this.prisma.creativeCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new BadRequestException('دسته‌بندی پرامپت پیدا نشد');
    }

    return this.prisma.creativePrompt.create({
      data: {
        title: dto.title,
        outputType: 'IMAGE',
        segment: CreativeSegment.GENERAL,
        categoryId: dto.categoryId,
        contextMd: dto.contextMd ?? dto.promptText,
        userPromptTemplate: dto.promptText,
        exampleImageUrl: dto.referenceImageUrl,
        aspectRatio: dto.aspectRatio,
        creditCost: dto.creditCost,
        sourceType: 'AGENT_DISCOVERED',
        agentSourceUrl: dto.sourceUrl,
        isActive: true,
      },
    });
  }
}
