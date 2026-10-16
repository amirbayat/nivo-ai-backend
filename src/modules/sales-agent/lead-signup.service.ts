import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import { normalizeLeadPhone } from '../../common/utils/lead-phone';
import { fa } from '../../i18n/fa';
import { isNivoLeadStore } from '../../common/utils/store-mode';

const CHAT_HISTORY_LIMIT = 30;

export interface LeadUtm {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

// docs/PRD-nivo-lead-shop-seller-signup.md §5.2/§5.3 — ثبت‌نام داخل چت فروشگاه لید:
// شماره (PHONE_SUBMITTED) → تأیید OTP (VERIFIED) → ساخت فروشگاه (STORE_CREATED)
@Injectable()
export class LeadSignupService {
  private readonly logger = new Logger(LeadSignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminNotifications: AdminNotificationsService,
    private readonly sellerBotApi: SellerBotApiClientService,
  ) {}

  private async loadLeadConversation(conversationId: string, sessionToken: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true, customer: true },
    });
    if (!conversation) throw new NotFoundException(fa.salesAgent.conversationNotFound);
    if (!sessionToken || conversation.customer.sessionToken !== sessionToken) {
      throw new ForbiddenException(fa.salesAgent.invalidSession);
    }
    // فقط فروشگاه لید؛ برای بقیه وجود این مسیر لو نمی‌رود
    if (!isNivoLeadStore(conversation.store)) throw new NotFoundException(fa.store.notFound);
    return conversation;
  }

  private cleanUtm(utm?: LeadUtm): LeadUtm {
    const out: LeadUtm = {};
    for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent'] as const) {
      const value = utm?.[key]?.trim().slice(0, 100);
      if (value) out[key] = value;
    }
    return out;
  }

  async submitPhone(conversationId: string, sessionToken: string, rawPhone: string, utm?: LeadUtm) {
    const conversation = await this.loadLeadConversation(conversationId, sessionToken);
    const phone = normalizeLeadPhone(rawPhone);
    if (!phone) throw new BadRequestException(fa.validation.phoneInvalid);

    const where = { storeId_conversationId: { storeId: conversation.storeId, conversationId } };
    const existing = await this.prisma.leadProfile.findUnique({ where });
    // کاربری که قبلاً تأیید شده/فروشگاه ساخته، هرگز به PHONE_SUBMITTED برنمی‌گردد
    if (existing && (existing.signupStatus === 'VERIFIED' || existing.signupStatus === 'STORE_CREATED')) {
      return { ok: true };
    }

    const chatHistory = await this.buildChatHistory(conversationId);
    await this.prisma.leadProfile.upsert({
      where,
      create: {
        storeId: conversation.storeId,
        conversationId,
        phone,
        chatHistory,
        source: 'sales_agent_lead_capture',
        signupStatus: 'PHONE_SUBMITTED',
        ...this.cleanUtm(utm),
      },
      update: { phone, chatHistory, signupStatus: 'PHONE_SUBMITTED', ...this.cleanUtm(utm) },
    });
    await this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: { leadFunnelStage: 'LEAD_CAPTURED' },
    });

    const lead = existing ?? null;
    const text = fa.leadSignup.newLead(lead?.name, phone, this.firstInterest(lead?.interests));
    await this.notify(conversation.store.sellerBotChatId, text, { conversationId, phone, stage: 'PHONE_SUBMITTED' });
    return { ok: true };
  }

  async markVerified(conversationId: string, sessionToken: string, userId: string) {
    const conversation = await this.loadLeadConversation(conversationId, sessionToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user) throw new NotFoundException(fa.admin.userNotFound);

    const where = { storeId_conversationId: { storeId: conversation.storeId, conversationId } };
    const existing = await this.prisma.leadProfile.findUnique({ where });
    const alreadyDone = existing?.signupStatus === 'VERIFIED' || existing?.signupStatus === 'STORE_CREATED';
    const now = new Date();
    // شماره‌ی لید فقط وقتی خالی است از User پر می‌شود؛ اگر متفاوت بود فقط userId ست می‌شود (PRD §5.2)
    await this.prisma.leadProfile.upsert({
      where,
      create: {
        storeId: conversation.storeId,
        conversationId,
        phone: user.phone,
        userId,
        source: 'sales_agent_lead_capture',
        signupStatus: 'VERIFIED',
        signedUpAt: now,
      },
      update: {
        userId,
        ...(existing?.phone ? {} : { phone: user.phone }),
        ...(existing?.signupStatus === 'STORE_CREATED' ? {} : { signupStatus: 'VERIFIED' as const }),
        ...(existing?.signedUpAt ? {} : { signedUpAt: now }),
      },
    });
    if (!alreadyDone) {
      await this.notify(conversation.store.sellerBotChatId, fa.leadSignup.verified(user.phone ?? existing?.phone), {
        conversationId,
        stage: 'VERIFIED',
      });
    }
    return { ok: true };
  }

  // موقع ساخت اولین فروشگاه غیردمو؛ خطایش هرگز ساخت فروشگاه را نمی‌شکند
  async markStoreCreated(userId: string): Promise<void> {
    try {
      await this.prisma.leadProfile.updateMany({
        where: { userId, signupStatus: { in: ['PHONE_SUBMITTED', 'VERIFIED'] } },
        data: { signupStatus: 'STORE_CREATED' },
      });
    } catch (err) {
      this.logger.warn(`markStoreCreated failed for user ${userId}: ${(err as Error).message}`);
    }
  }

  private firstInterest(interests: Prisma.JsonValue | null | undefined): string | null {
    return Array.isArray(interests) && typeof interests[0] === 'string' ? interests[0] : null;
  }

  private async buildChatHistory(conversationId: string): Promise<Prisma.InputJsonValue> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY'] } },
      orderBy: { createdAt: 'desc' },
      take: CHAT_HISTORY_LIMIT,
    });
    return events
      .reverse()
      .map((e) => ({
        role: e.type === 'CUSTOMER_MESSAGE' ? 'user' : 'assistant',
        content: (e.payload as { text?: string } | null)?.text ?? '',
      }))
      .filter((m) => m.content);
  }

  private async notify(sellerBotChatId: string | null, text: string, metadata: Record<string, string>): Promise<void> {
    await this.adminNotifications
      .notify('LEAD_SIGNUP', fa.leadSignup.title, text, metadata)
      .catch((err) => this.logger.warn(`admin lead notification failed: ${(err as Error).message}`));
    if (sellerBotChatId) {
      await this.sellerBotApi.sendText(sellerBotChatId, text).catch(() => undefined);
    }
  }
}
