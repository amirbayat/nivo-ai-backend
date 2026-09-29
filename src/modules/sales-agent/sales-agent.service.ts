import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ConversationEngineService } from './conversation-engine.service';
import { pickVariant } from './model-variants';
import { fa } from '../../i18n/fa';
import type { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class SalesAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
  ) {}

  // productId اختیاری — لینک اختصاصی یک محصول (فروشنده در استوری گذاشته)؛ اگر معتبر و
  // متعلق به همین فروشگاه باشد، اولین پاسخ مکالمه مستقیم همان محصول را نشان می‌دهد
  // (بدون NLU) و در همین پاسخ startChat برمی‌گردد — فرانت مجبور نیست یک کیک‌آف عمومی
  // جدا بفرستد
  async startChat(slug: string, productId?: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    const sessionToken = crypto.randomUUID();
    const customer = await this.prisma.customer.create({
      data: {
        storeId: store.id,
        sessionToken,
        salesConversation: {
          create: { storeId: store.id, abVariant: pickVariant() },
        },
      },
      include: { salesConversation: true },
    });

    const conversationId = customer.salesConversation!.id;

    let initial: { reply: string; uiBlocks: unknown[]; state: string } | undefined;
    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      if (product && product.storeId === store.id) {
        const conversation = await this.prisma.salesConversation.findUnique({
          where: { id: conversationId },
          include: { store: true },
        });
        initial = await this.engine.showProduct(conversation!, product);
      }
    }

    return {
      conversationId,
      sessionToken,
      storeName: store.name,
      ...(initial
        ? {
            initialReply: initial.reply,
            initialUiBlocks: initial.uiBlocks,
            initialState: initial.state,
          }
        : {}),
    };
  }

  // مالکیت مکالمه را با sessionToken چک می‌کند — الگوی ownership گام ۰ (store.service.ts
  // getOwned)، فقط اینجا کلید session است، نه JWT، چون Customer یک User نیست
  private async loadOwned(conversationId: string, sessionToken: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true, customer: true },
    });
    if (!conversation)
      throw new NotFoundException(fa.salesAgent.conversationNotFound);
    if (!sessionToken || conversation.customer.sessionToken !== sessionToken) {
      throw new ForbiddenException(fa.salesAgent.invalidSession);
    }
    return conversation;
  }

  async sendMessage(
    conversationId: string,
    sessionToken: string,
    dto: SendMessageDto,
  ) {
    const conversation = await this.loadOwned(conversationId, sessionToken);

    // مکالمه‌ای که به انسان سپرده شده دیگر نباید از NLU/موتور مکالمه رد شود — فقط پیام
    // مشتری لاگ می‌شود تا فروشنده در تب «نیاز به توجه» ببیندش (خودش جواب می‌دهد)
    if (conversation.isMutedForHuman) {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: dto.message ?? '' },
        },
      });
      return { reply: '', uiBlocks: [], state: conversation.currentState };
    }

    if (dto.action) {
      return this.engine.handleAction(conversation, dto.action);
    }
    if (!dto.message) throw new BadRequestException(fa.errors.validation);
    return this.engine.handleMessage(conversation, dto.message);
  }

  async submitReceipt(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    if (!file.mimetype.startsWith('image/'))
      throw new BadRequestException(fa.errors.validation);

    const conversation = await this.loadOwned(conversationId, sessionToken);
    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const key = await this.storage.uploadImage(
      file.buffer,
      ext,
      conversation.id,
    );
    return this.engine.handleReceiptUpload(conversation, key);
  }

  async getConversation(conversationId: string, sessionToken: string) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    return {
      state: conversation.currentState,
      storeName: conversation.store.name,
      events,
    };
  }
}
