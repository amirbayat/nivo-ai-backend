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
import {
  CreativeGenerationStatus,
  CreativeOutputType,
} from '@prisma/client';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(userId: string, dto: CreateConversationDto) {
    if (dto.projectId) await this.assertProjectOwnership(userId, dto.projectId);
    return this.prisma.conversation.create({
      data: { userId, ...dto },
    });
  }

  private async assertProjectOwnership(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException(fa.discovery.projectNotFound);
    if (project.userId !== userId) throw new ForbiddenException(fa.errors.forbidden);
  }

  async findAll(userId: string, query: ListConversationsDto) {
    const limit = query.limit ?? 20;
    const { cursor, projectId } = query;

    const items = await this.prisma.conversation.findMany({
      where: { userId, isArchived: false, ...(projectId ? { projectId } : {}) },
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

    // تولیدهای دیسکاوری (استفاده از سبک/استودیو) داخل همین مکالمه — Message جدا برایشان
    // نوشته نمی‌شود (creative_generations یک جدول کاملاً مجزاست)، پس اینجا هر تولید را به دو
    // پیام مصنوعی (کاربر + نتیجه) تبدیل می‌کنیم و بر اساس createdAt با پیام‌های واقعی ادغام
    // می‌کنیم — دقیقاً همون چیزی که فرانت موقع تولید زنده (virtualMessages) نشان می‌دهد
    const creativeGenerations = await this.prisma.creativeGeneration.findMany(
      {
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          outputType: true,
          inputImageKeys: true,
          outputImageKey: true,
          outputText: true,
          userInput: true,
          status: true,
          createdAt: true,
        },
      },
    );
    const creativeMessages = creativeGenerations.flatMap((gen) => {
      const inputImages = (gen.inputImageKeys as string[] | null)?.map(
        (key) => `/v2/discovery/images/${key}`,
      );
      const userTurn = {
        id: `creative-${gen.id}-user`,
        conversationId: id,
        role: 'USER' as const,
        content: gen.userInput ?? '',
        images: inputImages?.length ? inputImages : null,
        tokensInput: 0,
        tokensOutput: 0,
        createdAt: gen.createdAt,
        feedback: null,
      };
      const succeeded = gen.status === CreativeGenerationStatus.SUCCEEDED;
      const assistantTurn = {
        id: `creative-${gen.id}-assistant`,
        conversationId: id,
        role: 'ASSISTANT' as const,
        content: succeeded
          ? gen.outputText ?? ''
          : fa.discovery.generationFailed,
        images:
          succeeded &&
          gen.outputType === CreativeOutputType.IMAGE &&
          gen.outputImageKey
            ? [`/v2/discovery/images/${gen.outputImageKey}`]
            : null,
        tokensInput: 0,
        tokensOutput: 0,
        // یک میلی‌ثانیه بعد از پیام کاربر — تا ترتیب ادغام‌شده با پیام‌های واقعی همیشه
        // «کاربر قبل از پاسخ» بماند، حتی اگر createdAt دو ردیف مساوی باشد
        createdAt: new Date(gen.createdAt.getTime() + 1),
        feedback: null,
      };
      return [userTurn, assistantTurn];
    });

    // کلیدهای MinIO دیگر به presigned URL تبدیل نمی‌شوند (آن لینک بدون هیچ auth ای، تا وقتی
    // منقضی شود، برای هرکسی که به آن دسترسی پیدا کند کار می‌کرد) — به‌جایش یک مسیر نسبی از
    // بک‌اند خودمان برمی‌گردد که پشت همین JwtGuard + چک مالکیت بالا سرو می‌شود
    // (conversations.controller.ts، GET /:id/images/:filename)؛ فرانت با header واقعی Authorization
    // آن را می‌گیرد و به blob URL تبدیل می‌کند. رکوردهای قدیمی که هنوز base64 خام‌اند دست‌نخورده می‌مانند.
    const realMessages = conversation.messages.map((m) => {
      if (!m.images) return m;
      const images = (m.images as string[]).map((img) =>
        this.storage.isStorageKey(img)
          ? `/conversations/${id}/images/${img.split('/').pop()}`
          : img,
      );
      return { ...m, images };
    });

    const messages = [...realMessages, ...creativeMessages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

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
