import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { fa } from '../../i18n/fa';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  create(userId: string, dto: CreateConversationDto) {
    return this.prisma.conversation.create({
      data: { userId, ...dto },
    });
  }

  async findAll(userId: string, query: ListConversationsDto) {
    const limit = query.limit ?? 20;
    const { cursor } = query;

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
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    return {
      items: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
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
    });

    if (!conversation) throw new NotFoundException(fa.conversations.notFound);
    if (conversation.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden);

    // کلیدهای MinIO دیگر به presigned URL تبدیل نمی‌شوند (آن لینک بدون هیچ auth ای، تا وقتی
    // منقضی شود، برای هرکسی که به آن دسترسی پیدا کند کار می‌کرد) — به‌جایش یک مسیر نسبی از
    // بک‌اند خودمان برمی‌گردد که پشت همین JwtGuard + چک مالکیت بالا سرو می‌شود
    // (conversations.controller.ts، GET /:id/images/:filename)؛ فرانت با header واقعی Authorization
    // آن را می‌گیرد و به blob URL تبدیل می‌کند. رکوردهای قدیمی که هنوز base64 خام‌اند دست‌نخورده می‌مانند.
    const messages = conversation.messages.map((m) => {
      if (!m.images) return m;
      const images = (m.images as string[]).map((img) =>
        this.storage.isStorageKey(img)
          ? `/conversations/${id}/images/${img.split('/').pop()}`
          : img,
      );
      return { ...m, images };
    });

    return { ...conversation, messages };
  }

  async getImage(
    conversationId: string,
    filename: string,
    userId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation) throw new NotFoundException(fa.conversations.notFound);
    if (conversation.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden);

    const ext = filename.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(
      `${conversationId}/${filename}`,
    );
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  async update(id: string, userId: string, dto: UpdateConversationDto) {
    await this.assertOwnership(id, userId);
    return this.prisma.conversation.update({ where: { id }, data: dto });
  }

  async archive(id: string, userId: string) {
    await this.assertOwnership(id, userId);
    await this.prisma.conversation.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  private async assertOwnership(id: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!conv) throw new NotFoundException(fa.conversations.notFound);
    if (conv.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden);
  }
}
