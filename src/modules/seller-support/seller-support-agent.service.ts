import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { Store } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { withCallSite } from '../../common/ai-cost-engine/ace-context';
import { PricingService } from '../usage/pricing.service';
import { StoreService } from '../store/store.service';
import { StoreCreditService } from '../store/store-credit.service';
import { computeProductCompleteness } from '../store/product-completeness.util';
import { defaultModel } from '../sales-agent/model-variants';
import type { CartItem } from '../sales-agent/sales-agent.types';
import { SellerSupportTicketService } from './seller-support-ticket.service';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-bot-support-agent.md بخش ۳ — عامل پشتیبانی داخل بات فروشنده. همه‌ی ابزارها
// فقط‌خواندنی و محدود به store همان chat هستند (storeId از بیرون/مدل گرفته نمی‌شود).
// ابزار escalate_to_human تنها ابزار نوشتنی است و فقط تیکت پشتیبانی می‌سازد (فاز ۳).
export const DAILY_AGENT_MESSAGE_CAP = 40;
const MEMORY_MESSAGES = 10;
const MEMORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_TOOL_ROWS = 10;
const MAX_REPLY_CHARS = 3500;

export interface SupportAgentReply {
  text: string;
  capped: boolean;
  escalated: boolean;
}

@Injectable()
export class SellerSupportAgentService {
  private readonly logger = new Logger(SellerSupportAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly aiProvider: AiProviderService,
    private readonly pricing: PricingService,
    private readonly storeService: StoreService,
    private readonly storeCredit: StoreCreditService,
    private readonly ticketService: SellerSupportTicketService,
  ) {}

  private modelId(): string {
    return this.config.get<string>('SELLER_SUPPORT_MODEL')?.trim() || defaultModel();
  }

  // شمارنده‌ی روزانه در Redis؛ اگر Redis خطا بدهد، پشتیبانی نباید از کار بیفتد (fail-open)
  private async consumeDailyQuota(storeId: string): Promise<boolean> {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
    const key = `seller-support:cnt:${storeId}:${day}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 36 * 60 * 60);
      return n <= DAILY_AGENT_MESSAGE_CAP;
    } catch (err) {
      this.logger.warn(`daily quota check failed: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }

  private async buildSystemPrompt(store: Store): Promise<string> {
    const docs = await this.prisma.supportDoc.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { title: true, body: true },
    });
    const trialActive =
      !!store.trialEndsAt && store.trialEndsAt > new Date() && store.trialCreditRemainingToman > 0;
    const docsBlock = docs.length
      ? docs.map((d) => `## ${d.title}\n${d.body}`).join('\n\n')
      : '(هنوز هیچ داک راهنمایی ثبت نشده)';
    return [
      'تو پشتیبان نیوو برای فروشنده‌ها هستی و داخل بات تلگرام جواب می‌دی.',
      'فارسی محاوره‌ای، کوتاه (حداکثر ~۸ خط)، قدم‌به‌قدم. از مارک‌داون سنگین (جدول، هدینگ) استفاده نکن؛ متن ساده.',
      '',
      'قوانین:',
      '- فقط بر اساس «داک‌های راهنما» و خروجی ابزارها جواب بده. اگر جواب در داک‌ها نیست، حدس نزن؛ صادقانه بگو مطمئن نیستی.',
      '- درباره‌ی داده‌ی خود فروشگاه (محصولات ناقص، سفارش‌ها، اعتبار، گفتگوهای منتظر) حتماً از ابزارها بخون، از خودت عدد نساز.',
      '- هیچ کاری (تغییر محصول، تایید سفارش، ...) از طرف فروشنده انجام نمی‌دی؛ فقط راهنمایی می‌کنی.',
      '- اگر جواب در داک‌ها نیست، یا موضوع پول/استرداد، مشکل حساب یا باگ است، یا فروشنده پشتیبان انسانی خواست: ابزار escalate_to_human را صدا بزن. فقط وقتی ابزار ok برگرداند می‌توانی بگویی به پشتیبانی رسید؛ خودت وعده‌ی پیگیری نده.',
      '',
      'اطلاعات فروشگاه این فروشنده:',
      `- نام: ${store.name}${store.category ? ` | دسته: ${store.category}` : ''}`,
      `- اینستاگرام: ${store.instagramConnectedAt ? 'وصل است' : 'وصل نیست'}`,
      `- اعتبار: ${store.creditBalanceToman.toLocaleString('fa-IR')} تومان${trialActive ? ' + اعتبار آزمایشی فعال' : ''}`,
      '',
      '=== داک‌های راهنما ===',
      docsBlock,
    ].join('\n');
  }

  private async loadMemory(storeId: string) {
    const rows = await this.prisma.sellerSupportMessage.findMany({
      where: {
        storeId,
        createdAt: { gte: new Date(Date.now() - MEMORY_WINDOW_MS) },
        role: { in: ['SELLER', 'ASSISTANT'] },
      },
      orderBy: { createdAt: 'desc' },
      take: MEMORY_MESSAGES,
      select: { role: true, body: true },
    });
    return rows.reverse().map((r) => ({
      role: r.role === 'SELLER' ? ('user' as const) : ('assistant' as const),
      content: r.body,
    }));
  }

  private buildTools(store: Store, lastMessage: string, state: { escalated: boolean }) {
    const storeId = store.id;
    return {
      escalate_to_human: tool({
        description:
          'ارجاع به پشتیبان انسانی (ساخت تیکت). وقتی جواب در داک‌ها نیست، موضوع پول/استرداد/مشکل حساب/باگ است، یا فروشنده صریح پشتیبان انسانی خواست.',
        inputSchema: z.object({
          summary: z.string().min(3).describe('خلاصه‌ی یک‌خطی مشکل فروشنده'),
          reason: z.string().min(3).describe('چرا ارجاع می‌دهی'),
        }),
        execute: async ({ summary, reason }) => {
          if (state.escalated) return { ok: true, duplicate: true };
          await this.ticketService.escalate({ store, summary, reason, lastMessage });
          state.escalated = true;
          return { ok: true };
        },
      }),
      get_store_status: tool({
        description: 'چک‌لیست راه‌اندازی فروشگاه، وضعیت اعتبار/trial و اتصال‌ها',
        inputSchema: z.object({}),
        execute: async () => {
          const [completeness, credit] = await Promise.all([
            this.storeService.getCompleteness(store.sellerId, storeId),
            this.storeCredit.getStatus(store.sellerId, storeId),
          ]);
          return {
            overallScorePercent: completeness.overallScorePercent,
            checklist: completeness.checklist,
            launch: completeness.launch,
            balanceToman: credit.balanceToman,
            trialCreditRemainingToman: credit.trialCreditRemainingToman,
            trialEndsAt: credit.trialEndsAt,
            instagramConnected: !!store.instagramConnectedAt,
          };
        },
      }),
      get_incomplete_products: tool({
        description: 'محصولات فعال که ناقص‌اند (کمتر از ۱۰۰٪): اسم، درصد، فیلدهای کمبود',
        inputSchema: z.object({ limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(5) }),
        execute: async ({ limit }) => {
          const [products, kbCounts] = await Promise.all([
            this.prisma.product.findMany({
              where: { storeId, status: 'ACTIVE' },
              select: {
                id: true,
                name: true,
                images: true,
                description: true,
                trackStock: true,
                optionTypes: { select: { id: true } },
                variants: { select: { stock: true } },
              },
            }),
            this.prisma.storeKbEntry.groupBy({
              by: ['relatedProductId'],
              where: { storeId, isActive: true, relatedProductId: { not: null } },
              _count: { _all: true },
            }),
          ]);
          const kbByProduct = new Map(kbCounts.map((c) => [c.relatedProductId as string, c._count._all]));
          const incomplete = products
            .map((p) => ({
              name: p.name,
              ...computeProductCompleteness(
                {
                  ...p,
                  hasVariants: p.optionTypes.length > 0,
                  hasZeroStockVariants:
                    p.trackStock && p.optionTypes.length > 0 && p.variants.every((v) => v.stock === 0),
                },
                kbByProduct.get(p.id) ?? 0,
              ),
            }))
            .filter((p) => p.percent < 100)
            .sort((a, b) => a.percent - b.percent);
          return { totalIncomplete: incomplete.length, items: incomplete.slice(0, limit) };
        },
      }),
      get_recent_orders: tool({
        description: 'آخرین سفارش‌های فروشگاه: کد سفارش، مبلغ (تومان)، وضعیت',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(5),
          status: z.string().optional().describe('مثلاً PENDING_PAYMENT یا RECEIPT_SUBMITTED'),
        }),
        execute: async ({ limit, status }) => {
          const orders = await this.prisma.order.findMany({
            where: { storeId, ...(status ? { status: status as never } : {}) },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: { orderCode: true, totalAmount: true, status: true, createdAt: true },
          });
          return orders.map((o) => ({
            orderCode: o.orderCode,
            totalAmount: o.totalAmount,
            status: fa.sellerBot.orderStatusLabel[o.status] ?? o.status,
            createdAt: o.createdAt,
          }));
        },
      }),
      get_order: tool({
        description: 'جزئیات یک سفارش با کد سفارش',
        inputSchema: z.object({ code: z.string().min(1) }),
        execute: async ({ code }) => {
          const order = await this.prisma.order.findFirst({
            where: { storeId, orderCode: code.trim() },
            select: { orderCode: true, totalAmount: true, status: true, items: true, createdAt: true },
          });
          if (!order) return { found: false as const };
          return {
            found: true as const,
            orderCode: order.orderCode,
            totalAmount: order.totalAmount,
            status: fa.sellerBot.orderStatusLabel[order.status] ?? order.status,
            createdAt: order.createdAt,
            items: (order.items as CartItem[]).map((i) => ({
              name: i.name,
              variantLabel: i.variantLabel ?? null,
              qty: i.qty,
            })),
          };
        },
      }),
      get_needed_attention: tool({
        description: 'گفتگوهای مشتری که منتظر جواب خود فروشنده‌اند',
        inputSchema: z.object({}),
        execute: async () => {
          const rows = await this.storeService.listNeededAttention(store.sellerId, storeId);
          return {
            total: rows.length,
            items: rows.slice(0, MAX_TOOL_ROWS).map((r) => ({
              customer: r.customerLabel,
              updatedAt: r.updatedAt,
            })),
          };
        },
      }),
    };
  }

  async handle(store: Store, text: string): Promise<SupportAgentReply> {
    const within = await this.consumeDailyQuota(store.id);
    if (!within) {
      // ۳.۳ — بعد از سقف، ارجاع مستقیم بدون AI
      await this.prisma.sellerSupportMessage.create({
        data: { storeId: store.id, role: 'SELLER', body: text },
      });
      await this.ticketService.escalate({
        store,
        summary: 'سقف روزانه‌ی پیام دستیار پر شد',
        reason: 'ارجاع مستقیم بعد از سقف روزانه',
        lastMessage: text,
      });
      return { text: fa.sellerSupport.dailyCapReached, capped: true, escalated: true };
    }

    const memory = await this.loadMemory(store.id);
    await this.prisma.sellerSupportMessage.create({
      data: { storeId: store.id, role: 'SELLER', body: text },
    });

    const modelId = this.modelId();
    const state = { escalated: false };
    try {
      const result = await withCallSite(
        'seller_support',
        async () =>
          generateText({
            model: this.aiProvider.buildClient()(modelId),
            system: await this.buildSystemPrompt(store),
            messages: [...memory, { role: 'user', content: text }],
            tools: this.buildTools(store, text, state),
            stopWhen: stepCountIs(4),
            maxOutputTokens: 800,
            temperature: 0.3,
          }),
        { storeId: store.id },
      );

      // وقتی تیکت ساخته شد، متن ثابت ما جایگزین جواب مدل می‌شود تا وعده‌ی اشتباه نرود
      const reply = state.escalated
        ? fa.sellerSupport.escalated
        : (result.text || '').trim().slice(0, MAX_REPLY_CHARS) || fa.sellerSupport.agentFailed;
      const costToman = await this.pricing
        .calcCost(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0, modelId)
        .then((c) => c.costToman)
        .catch(() => undefined);
      await this.prisma.sellerSupportMessage.create({
        data: {
          storeId: store.id,
          role: 'ASSISTANT',
          body: reply,
          model: modelId,
          costToman: costToman ?? null,
        },
      });
      return { text: reply, capped: false, escalated: state.escalated };
    } catch (err) {
      this.logger.error(
        `support agent failed (store=${store.id}, model=${modelId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { text: fa.sellerSupport.agentFailed, capped: false, escalated: false };
    }
  }
}
