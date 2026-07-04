import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { fa } from '../../i18n/fa'
import { CreateConversationDto } from './dto/create-conversation.dto'
import { UpdateConversationDto } from './dto/update-conversation.dto'
import { ListConversationsDto } from './dto/list-conversations.dto'

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateConversationDto) {
    return this.prisma.conversation.create({
      data: { userId, ...dto },
    })
  }

  async findAll(userId: string, query: ListConversationsDto) {
    const limit = query.limit ?? 20
    const { cursor } = query

    const items = await this.prisma.conversation.findMany({
      where: { userId, isArchived: false },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        model: true,
        totalTokens: true,
        lastMessageAt: true,
        createdAt: true,
      },
    })

    const hasMore = items.length > limit
    const data = hasMore ? items.slice(0, limit) : items

    return {
      items: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    }
  }

  async findOne(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          // نکته: فیلد `model` عمداً از select حذف شده — مدل واقعی پاسخ‌دهنده (که ممکن است توسط
          // ModelRouterService بی‌صدا override شده باشد) نباید از طریق API به کاربر لو برود.
          // بازخورد خودِ کاربر (لایک/دیس‌لایک) بدون مشکل نمایش داده می‌شود چون رأی خودش است.
          select: {
            id: true,
            conversationId: true,
            role: true,
            content: true,
            images: true,
            tokensInput: true,
            tokensOutput: true,
            createdAt: true,
            feedback: { select: { vote: true, comment: true } },
          },
        },
      },
    })

    if (!conversation) throw new NotFoundException(fa.conversations.notFound)
    if (conversation.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden)

    return conversation
  }

  async update(id: string, userId: string, dto: UpdateConversationDto) {
    await this.assertOwnership(id, userId)
    return this.prisma.conversation.update({ where: { id }, data: dto })
  }

  async archive(id: string, userId: string) {
    await this.assertOwnership(id, userId)
    await this.prisma.conversation.update({
      where: { id },
      data: { isArchived: true },
    })
  }

  private async assertOwnership(id: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!conv) throw new NotFoundException(fa.conversations.notFound)
    if (conv.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden)
  }
}
