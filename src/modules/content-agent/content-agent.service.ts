import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreativeSegment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ArticlesService } from '../articles/articles.service';
import { CreateAgentArticleDto } from './dto/create-agent-article.dto';
import { CreateAgentImageDto } from './dto/create-agent-image.dto';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';

// همه‌ی عکس‌های عمومی این ایجنت زیر همین پیشوند مجازی در باکت مشترک MinIO ذخیره می‌شوند —
// جداسازی صرفاً با prefix، نه باکت جدا (بدون زیرساخت اضافه)؛ GET عمومی content-agent-public.controller.ts
// فقط همین پیشوند را می‌خواند، پس آپلود دلخواه به بقیه‌ی کلیدهای باکت از این مسیر ممکن نیست.
export const CONTENT_AGENT_PUBLIC_IMAGE_PREFIX = 'public-content';

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
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
  ) {}

  // ─── میزبانی عکس عمومی برای contentMd مقاله/پرامپت — بدون رندر سمت سرور ───────
  async createAgentImage(dto: CreateAgentImageDto): Promise<{ url: string }> {
    const ext = dto.ext ?? 'png';
    const buffer = Buffer.from(dto.imageBase64, 'base64');
    const key = await this.storageService.uploadImage(
      buffer,
      ext,
      CONTENT_AGENT_PUBLIC_IMAGE_PREFIX,
    );
    const filename = key.slice(CONTENT_AGENT_PUBLIC_IMAGE_PREFIX.length + 1);
    const apiUrl = this.config.get<string>('API_URL');
    return { url: `${apiUrl}/api/v1/content-agent/images/${filename}` };
  }

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
        description: dto.description,
        contextMd: dto.contextMd ?? dto.promptText,
        userPromptTemplate: dto.promptText,
        exampleImageUrl: dto.referenceImageUrl,
        aspectRatio: dto.aspectRatio,
        creditCost: dto.creditCost,
        preferredModel: dto.preferredModel,
        isFreeformPrompt: dto.isFreeformPrompt ?? false,
        sourceType: 'AGENT_DISCOVERED',
        agentSourceUrl: dto.sourceUrl,
        isActive: true,
      },
    });
  }
}
