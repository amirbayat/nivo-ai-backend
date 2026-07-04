import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { FeedbackVote, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { fa } from '../../i18n/fa'
import { SubmitMessageFeedbackDto } from './dto/submit-feedback.dto'

@Injectable()
export class MessageFeedbackService {
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  async submit(
    userId: string,
    messageId: string,
    dto: SubmitMessageFeedbackDto,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        role: true,
        model: true,
        conversation: { select: { userId: true } },
      },
    })
    if (!message) throw new NotFoundException(fa.messageFeedback.notFound)
    if (message.conversation.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden)
    if (message.role !== 'ASSISTANT')
      throw new BadRequestException(fa.messageFeedback.onlyAssistant)

    const feedback = await this.prisma.messageFeedback.upsert({
      where: { messageId },
      create: {
        messageId,
        userId,
        vote: dto.vote,
        comment: dto.comment,
        modelUsed: message.model ?? 'unknown',
      },
      update: { vote: dto.vote, comment: dto.comment ?? null },
    })

    return { message: fa.messageFeedback.submitted, vote: feedback.vote }
  }

  async getAll(page = 1, limit = 20, model?: string, vote?: FeedbackVote) {
    const skip = (page - 1) * limit
    const where = {
      ...(model ? { modelUsed: model } : {}),
      ...(vote ? { vote } : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.messageFeedback.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { message: { select: { content: true } } },
      }),
      this.prisma.messageFeedback.count({ where }),
    ])

    return { items, total, page, limit }
  }

  getSummary() {
    return this.prisma.modelFeedbackSummary.findFirst({
      orderBy: { createdAt: 'desc' },
    })
  }

  triggerSummary() {
    return this.runSummary()
  }

  /** فراخوانی‌شده هم از endpoint دستی ادمین هم از job شبانه — الگوی incremental summarization مثل FeedbackSummaryProcessor */
  async runSummary() {
    const previous = await this.prisma.modelFeedbackSummary.findFirst({
      orderBy: { createdAt: 'desc' },
    })

    const unchecked = await this.prisma.messageFeedback.findMany({
      where: { isChecked: false },
      take: 200,
      orderBy: { createdAt: 'asc' },
      include: { message: { select: { content: true } } },
    })

    if (!unchecked.length)
      return { message: fa.messageFeedback.summaryNotReady }

    const lines = unchecked
      .map((f) => {
        const snippet = f.message.content.slice(0, 200)
        const note = f.comment ? ` | توضیح کاربر: ${f.comment}` : ''
        return `[مدل: ${f.modelUsed} | رأی: ${f.vote}] پیام: "${snippet}"${note}`
      })
      .join('\n')

    const previousContext = previous
      ? `خلاصه‌ی قبلی: ${previous.summary}\nموارد قبلی: ${JSON.stringify(previous.topIssues)}\n\n`
      : ''

    const prompt = `${previousContext}بازخوردهای جدید کاربران روی پاسخ‌های مدل‌های هوش مصنوعی:
${lines}

این بازخوردها را تحلیل کن و فقط یک JSON معتبر با این ساختار برگردان:
{"summary":"۲-۳ جمله خلاصه‌ی فارسی از الگوهای کلی","topIssues":[{"model":"نام مدل","topic":"موضوع کوتاه پیام‌ها","downCount":عدد,"upCount":عدد,"sampleComments":["..."]}]}
حداکثر ۱۰ مورد در topIssues. تمرکز ویژه روی الگوهای تکراری در دیس‌لایک‌ها (کدام مدل برای چه نوع موضوعی بیشتر دیس‌لایک گرفته). هیچ متنی خارج از JSON ننویس.`

    const modelId =
      this.config.get<string>('SUMMARY_MODEL') ?? 'openai/gpt-4o-mini'
    const { text } = await generateText({
      model: this.provider(modelId),
      prompt,
    })

    let parsed: { summary: string; topIssues: unknown[] }
    try {
      parsed = JSON.parse(text) as { summary: string; topIssues: unknown[] }
    } catch {
      parsed = { summary: text, topIssues: [] }
    }

    const ids = unchecked.map((f) => f.id)

    await this.prisma.$transaction([
      this.prisma.modelFeedbackSummary.create({
        data: {
          summary: parsed.summary,
          topIssues: parsed.topIssues as Prisma.InputJsonValue,
          totalProcessed: unchecked.length + (previous?.totalProcessed ?? 0),
          checkedUpTo: new Date(),
        },
      }),
      this.prisma.messageFeedback.updateMany({
        where: { id: { in: ids } },
        data: { isChecked: true },
      }),
    ])

    return {
      message: fa.messageFeedback.submitted,
      processed: unchecked.length,
    }
  }
}
