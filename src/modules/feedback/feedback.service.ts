import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { fa } from '../../i18n/fa';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

@Injectable()
export class FeedbackService {
  private readonly provider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    });
  }

  async create(userId: string | null, dto: CreateFeedbackDto) {
    await (this.prisma as any).feedback.create({
      data: {
        userId: userId ?? null,
        category: dto.category ?? 'GENERAL',
        content: dto.content,
      },
    });
    return { message: fa.feedback.submitted };
  }

  async getAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      (this.prisma as any).feedback.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { phone: true } } },
      }),
      (this.prisma as any).feedback.count(),
    ]);
    return { items, total, page, limit };
  }

  async getSummary() {
    const summary = await (this.prisma as any).feedbackSummary.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return summary ?? null;
  }

  async triggerSummary() {
    const previous = await (this.prisma as any).feedbackSummary.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const unchecked = await (this.prisma as any).feedback.findMany({
      where: { isChecked: false },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });

    if (!unchecked.length) {
      return { message: fa.feedback.summaryNotReady };
    }

    const feedbackLines = (
      unchecked as Array<{ category: string; content: string }>
    )
      .map((f) => `[${f.category}] ${f.content}`)
      .join('\n');

    const previousContext = previous
      ? `Previous summary: ${previous.summary}\nPrevious top items: ${JSON.stringify(previous.topItems)}\n\n`
      : '';

    const prompt = `${previousContext}New user feedbacks:\n${feedbackLines}\n\nAnalyze these feedbacks and return ONLY valid JSON with this exact shape:\n{"summary":"2-3 sentence Persian summary","topItems":[{"title":"item title in Persian","count":number,"category":"CATEGORY"}]}\nReturn 5-10 top items. No markdown, no explanation, just JSON.`;

    const modelId =
      this.config.get<string>('SUMMARY_MODEL') ?? 'openai/gpt-4o-mini';
    const { text } = await generateText({
      model: this.provider(modelId),
      prompt,
    });

    let parsed: { summary: string; topItems: unknown[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { summary: text, topItems: [] };
    }

    const ids = (unchecked as Array<{ id: string }>).map((f) => f.id);

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).feedbackSummary.create({
        data: {
          summary: parsed.summary,
          topItems: parsed.topItems,
          totalCount: unchecked.length + (previous?.totalCount ?? 0),
          checkedUpTo: new Date(),
        },
      });
      await (tx as any).feedback.updateMany({
        where: { id: { in: ids } },
        data: { isChecked: true },
      });
    });

    return { message: fa.feedback.submitted, processed: unchecked.length };
  }
}
