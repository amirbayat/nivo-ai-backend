import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('feedback-summary')
export class FeedbackSummaryProcessor {
  private readonly logger = new Logger(FeedbackSummaryProcessor.name);
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

  @Process('summarize')
  async handleSummarize() {
    const previous = await (this.prisma as any).feedbackSummary.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const unchecked = await (this.prisma as any).feedback.findMany({
      where: { isChecked: false },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });

    if (!unchecked.length) {
      this.logger.log('No unchecked feedbacks — skipping summary');
      return;
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

    this.logger.log(
      `Feedback summary created — processed ${unchecked.length} feedbacks`,
    );
  }
}
