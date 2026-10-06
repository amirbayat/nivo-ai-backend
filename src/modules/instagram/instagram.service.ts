import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AutomationTriggerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InstagramApiClientService } from './instagram-api-client.service';
import type {
  InstagramWebhookEntry,
  InstagramWebhookPayload,
  ResolvedTriggerEvent,
} from './instagram.types';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۴.۳ — بدون ConversationEngineService؛
// فقط match rule + ارسال متن استاتیک. مشترک بین هر دو ریجن (بخش ۳).
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly api: InstagramApiClientService,
  ) {}

  // GET /instagram/webhook — challenge-response یک‌بار، موقع ثبت URL در Meta Developer
  verifyChallenge(
    mode?: string,
    token?: string,
    challenge?: string,
  ): string | null {
    const expected = this.config.get<string>('INSTAGRAM_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected) {
      return challenge ?? '';
    }
    return null;
  }

  // POST /instagram/webhook — امضای HMAC-SHA256 با app secret (نه یک secret ثابت مثل تلگرام)
  verifySignature(rawBody: Buffer, signatureHeader?: string): boolean {
    const appSecret = this.config.get<string>('INSTAGRAM_APP_SECRET');
    if (!appSecret || !signatureHeader) return false;
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signatureHeader),
      );
    } catch {
      return false;
    }
  }

  async handlePayload(payload: InstagramWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      await this.handleEntry(entry).catch((err) =>
        this.logger.error(`handleEntry failed for entry.id=${entry.id}`, err),
      );
    }
  }

  private async handleEntry(entry: InstagramWebhookEntry): Promise<void> {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;
      const text = change.value.text;
      if (!text) continue;
      await this.resolveAndDispatch({
        kind: 'COMMENT',
        storeInstagramBusinessId: entry.id,
        commentId: change.value.id,
        mediaId: change.value.media.id,
        text,
      });
    }

    for (const msg of entry.messaging ?? []) {
      if (!msg.message || msg.message.is_echo || !msg.message.text) continue;
      const isStoryMention = msg.message.attachments?.some(
        (a) => a.type === 'story_mention',
      );
      const isStoryReply = Boolean(msg.message.reply_to?.story);

      if (isStoryMention) {
        await this.resolveAndDispatch({
          kind: 'STORY_MENTION',
          storeInstagramBusinessId: entry.id,
          senderPsid: msg.sender.id,
          text: msg.message.text,
        });
      } else if (isStoryReply) {
        await this.resolveAndDispatch({
          kind: 'STORY_REPLY',
          storeInstagramBusinessId: entry.id,
          senderPsid: msg.sender.id,
          storyId: msg.message.reply_to?.story?.id,
          text: msg.message.text,
        });
      } else {
        await this.resolveAndDispatch({
          kind: 'DM',
          storeInstagramBusinessId: entry.id,
          senderPsid: msg.sender.id,
          text: msg.message.text,
        });
      }
    }
  }

  private async resolveAndDispatch(event: ResolvedTriggerEvent): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { instagramBusinessId: event.storeInstagramBusinessId },
      select: {
        id: true,
        instagramAccessToken: true,
        instagramBusinessId: true,
      },
    });
    if (!store || !store.instagramAccessToken) {
      this.logger.warn(
        `no connected store for instagramBusinessId=${event.storeInstagramBusinessId}`,
      );
      return;
    }

    const triggerType: AutomationTriggerType =
      event.kind === 'COMMENT'
        ? 'COMMENT_KEYWORD'
        : event.kind === 'STORY_REPLY'
          ? 'STORY_REPLY'
          : event.kind === 'STORY_MENTION'
            ? 'STORY_MENTION'
            : 'DM_KEYWORD';
    const mediaId =
      event.kind === 'COMMENT'
        ? event.mediaId
        : event.kind === 'STORY_REPLY'
          ? event.storyId
          : undefined;

    const rule = await this.matchRule(
      store.id,
      triggerType,
      mediaId,
      event.text,
    );
    if (!rule) return;

    if (event.kind === 'COMMENT') {
      if (rule.publicReplyEnabled && rule.staticReplyText) {
        await this.api.replyToComment(
          store.instagramAccessToken,
          event.commentId,
          rule.staticReplyText,
        );
      }
      await this.api.sendPrivateReplyToComment(
        store.instagramAccessToken,
        store.instagramBusinessId!,
        event.commentId,
        rule.staticDmText,
      );
    } else {
      await this.upsertCustomer(store.id, event.senderPsid);
      await this.api.sendDirectMessage(
        store.instagramAccessToken,
        store.instagramBusinessId!,
        event.senderPsid,
        rule.staticDmText,
      );
    }
  }

  // اولویت match: targetMediaId+keyword دقیق > فقط keyword > فقط targetMediaId > wildcard کامل
  private async matchRule(
    storeId: string,
    triggerType: AutomationTriggerType,
    mediaId: string | undefined,
    text: string,
  ) {
    const candidates = await this.prisma.instagramAutomationRule.findMany({
      where: {
        storeId,
        triggerType,
        isActive: true,
        OR: [{ targetMediaId: null }, { targetMediaId: mediaId ?? '__none__' }],
      },
    });

    const normalized = text.toLowerCase();
    const matching = candidates.filter(
      (r) => !r.keyword || normalized.includes(r.keyword.toLowerCase()),
    );
    if (matching.length === 0) return null;

    matching.sort((a, b) => this.specificity(b) - this.specificity(a));
    return matching[0];
  }

  private specificity(rule: {
    targetMediaId: string | null;
    keyword: string | null;
  }): number {
    return (rule.targetMediaId ? 2 : 0) + (rule.keyword ? 1 : 0);
  }

  private async upsertCustomer(storeId: string, psid: string): Promise<void> {
    await this.prisma.customer.upsert({
      where: { storeId_instagramPsid: { storeId, instagramPsid: psid } },
      create: { storeId, channel: 'INSTAGRAM', instagramPsid: psid },
      update: {},
    });
  }

  // بخش ۴.۱ — URL شروع OAuth برای دکمه‌ی «اتصال اینستاگرام» در پنل. redirect_uri یک صفحه‌ی
  // فرانت است (نه بک‌اند مستقیم)؛ فرانت بعد از ریدایرکت، code را به endpoint احرازشده‌ی
  // زیر (handleOAuthCallback، با storeId از همان نشست لاگین) می‌دهد — پس state نیازی به
  // حمل storeId ندارد، فقط یک nonce ساده‌ی CSRF اختیاری فرانت است
  getConnectUrl(state?: string): string | null {
    const appId = this.config.get<string>('INSTAGRAM_APP_ID');
    const redirectUri = this.config.get<string>('INSTAGRAM_REDIRECT_URI');
    if (!appId || !redirectUri) return null;
    const scopes = [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
    ].join(',');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      ...(state ? { state } : {}),
    });
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  async handleOAuthCallback(storeId: string, code: string): Promise<boolean> {
    const redirectUri = this.config.get<string>('INSTAGRAM_REDIRECT_URI');
    if (!redirectUri) return false;
    const result = await this.api.exchangeCodeForLongLivedToken(
      code,
      redirectUri,
    );
    if (!result) return false;

    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        instagramBusinessId: result.igBusinessId,
        instagramAccessToken: result.accessToken,
        instagramConnectedAt: new Date(),
        instagramTokenExpiresAt: new Date(
          Date.now() + result.expiresInSeconds * 1000,
        ),
      },
    });
    return true;
  }

  // docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳.۱ — مسیر IR از همان
  // GET /v2/stores/me (JwtGuard) این دو فیلد را می‌خواند؛ مینی‌پنل INTL آن کنترلر را
  // اصلاً import نمی‌کند (بخش ۳.۱، بدون import از ماژول‌های دیگر) پس همین‌جا یک
  // endpoint مجزا و سبک لازم است
  async getStoreInstagramStatus(storeId: string): Promise<{
    instagramBusinessId: string | null;
    instagramConnectedAt: Date | null;
  }> {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { instagramBusinessId: true, instagramConnectedAt: true },
    });
    return store;
  }

  // بخش ۴.۴ — CRUD rule، مشترک بین هر دو ریجن (هر دو کنترلر همین متدها را صدا می‌زنند)
  listRules(storeId: string) {
    return this.prisma.instagramAutomationRule.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createRule(
    storeId: string,
    data: {
      triggerType: AutomationTriggerType;
      targetMediaId?: string;
      keyword?: string;
      staticReplyText?: string;
      staticDmText: string;
      publicReplyEnabled?: boolean;
    },
  ) {
    return this.prisma.instagramAutomationRule.create({
      data: { storeId, ...data },
    });
  }

  async updateRule(
    storeId: string,
    ruleId: string,
    data: Partial<{
      targetMediaId: string | null;
      keyword: string | null;
      staticReplyText: string | null;
      staticDmText: string;
      publicReplyEnabled: boolean;
      isActive: boolean;
    }>,
  ) {
    const rule = await this.prisma.instagramAutomationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule || rule.storeId !== storeId) return null;
    return this.prisma.instagramAutomationRule.update({
      where: { id: ruleId },
      data,
    });
  }

  async deleteRule(storeId: string, ruleId: string): Promise<boolean> {
    const rule = await this.prisma.instagramAutomationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule || rule.storeId !== storeId) return false;
    await this.prisma.instagramAutomationRule.delete({ where: { id: ruleId } });
    return true;
  }

  // بخش ۵ (Meta App Review) — کال‌بک حذف داده‌ی کاربر
  async deleteStoreInstagramData(instagramBusinessId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { instagramBusinessId },
      select: { id: true },
    });
    if (!store) return;

    await this.prisma.$transaction([
      this.prisma.instagramAutomationRule.deleteMany({
        where: { storeId: store.id },
      }),
      this.prisma.customer.deleteMany({
        where: { storeId: store.id, channel: 'INSTAGRAM' },
      }),
      this.prisma.store.update({
        where: { id: store.id },
        data: {
          instagramBusinessId: null,
          instagramAccessToken: null,
          instagramConnectedAt: null,
          instagramTokenExpiresAt: null,
        },
      }),
    ]);
  }
}
