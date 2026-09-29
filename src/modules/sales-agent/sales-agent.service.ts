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
import { fa } from '../../i18n/fa';

@Injectable()
export class SalesAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
  ) {}

  async startChat(slug: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    const sessionToken = crypto.randomUUID();
    const customer = await this.prisma.customer.create({
      data: {
        storeId: store.id,
        sessionToken,
        salesConversation: { create: { storeId: store.id } },
      },
      include: { salesConversation: true },
    });

    return {
      conversationId: customer.salesConversation!.id,
      sessionToken,
      storeName: store.name,
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
    message: string,
  ) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    return this.engine.handleMessage(conversation, message);
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
    return { state: conversation.currentState, storeName: conversation.store.name, events };
  }
}
