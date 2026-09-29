import { Injectable } from '@nestjs/common';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { ConversationState, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { fa } from '../../i18n/fa';
import { defaultModel, resolveModel } from './model-variants';
import type {
  CartItem,
  ConversationContext,
  EngineResult,
  ParsedIntent,
  SalesAction,
  UiBlock,
} from './sales-agent.types';

type ConversationWithStore = Prisma.SalesConversationGetPayload<{
  include: { store: true };
}>;

type ProductLike = {
  id: string;
  name: string;
  basePrice: number;
  stock: number;
  images: string[];
};

// آستانه‌ی handoff: بعد از این تعداد پیام پیاپی نامفهوم/بی‌نتیجه، مکالمه به انسان سپرده
// می‌شود (طبق جدول دیسپچ پلن گام ۱) — تایمر ندارد، فقط شمارنده.
// فیدبک اول پایلوت: از ۲ به ۴ افزایش یافت — ۲ خیلی زود escalate می‌کرد، مخصوصاً وقتی خودِ
// دکمه‌های UI هم (قبل از فیکس handleAction) از مسیر NLU رد می‌شدند و گاهی نامفهوم تشخیص
// داده می‌شدند
const HANDOFF_CLARIFY_THRESHOLD = 4;

@Injectable()
export class ConversationEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
  ) {}

  private getContext(conversation: ConversationWithStore): ConversationContext {
    const raw =
      conversation.contextData as unknown as ConversationContext | null;
    return {
      cart: raw?.cart ?? [],
      lastShownProducts: raw?.lastShownProducts ?? [],
    };
  }

  private cartTotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }

  // یک ردیف آماری به‌ازای هر فراخوانی واقعی مدل (چه موفق، چه شکست‌خورده) — بخش C پلن
  // فیدبک اول پایلوت (A/B مدل‌ها)
  private async logAiCall(
    conversation: ConversationWithStore,
    kind: 'PARSE_INTENT' | 'CAPTION',
    success: boolean,
    latencyMs: number,
  ) {
    await this.prisma.abModelMetric.create({
      data: {
        conversationId: conversation.id,
        variant: conversation.abVariant ?? 'gpt-5.4-mini',
        kind,
        success,
        latencyMs,
      },
    });
  }

  private async callParseIntent(
    text: string,
    state: ConversationState,
    model: string,
  ): Promise<ParsedIntent> {
    const { object } = await generateObject({
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      schema: z.object({
        intent: z.enum([
          'BROWSE',
          'ADD_TO_CART',
          'REMOVE_FROM_CART',
          'VIEW_CART',
          'CHECKOUT',
          'ASK_FAQ',
          'CONFIRM',
          'CANCEL',
          'REQUEST_HUMAN',
          'UNCLEAR',
        ]),
        productQuery: z.string().optional(),
        productIndex: z.number().int().positive().optional(),
        quantity: z.number().int().positive().optional(),
      }),
      system: `تو فقط یک استخراج‌کننده‌ی intent هستی، نه فروشنده — هیچ تصمیمی نمی‌گیری، فقط
پیام مشتری یک فروشگاه اینستاگرامی را دسته‌بندی می‌کنی.
وضعیت فعلی مکالمه: ${state}
intent های ممکن:
- BROWSE: مشتری می‌خواهد محصولات را ببیند یا درباره‌ی محصولی می‌پرسد
- ADD_TO_CART: می‌خواهد چیزی به سبد اضافه کند (productQuery=نام محصول یا productIndex=ارجاع ترتیبی مثل «اولی»/«دومی»، quantity=تعداد اگر گفته)
- REMOVE_FROM_CART: می‌خواهد چیزی از سبد حذف کند
- VIEW_CART: می‌خواهد سبدش را ببیند
- CHECKOUT: می‌خواهد سفارش نهایی/پرداخت کند
- CONFIRM: تایید می‌کند (مثلاً «بله»، «تایید»، «باشه» بعد از دیدن سبد)
- CANCEL: می‌خواهد لغو کند/سبد را خالی کند
- ASK_FAQ: سؤال عمومی (نه درباره‌ی یک محصول خاص برای اضافه‌کردن)
- REQUEST_HUMAN: صریحاً می‌خواهد با یک آدم واقعی صحبت کند
- UNCLEAR: نامفهوم یا نامرتبط
فقط JSON مطابق schema برگردان.`,
      prompt: text,
    });
    return object;
  }

  // فقط NLU — مدل هرگز مستقیم DB/state تغییر نمی‌دهد، فقط intent+entity استخراج می‌کند
  // (طبق قرارداد تول پلن گام ۱). با fallback واقعی: اگر مدل assign‌شده (A/B) throw کند،
  // یک بار دیگر با مدل پیش‌فرض امن تلاش می‌شود، نه مستقیم UNCLEAR
  private async parseIntent(
    text: string,
    conversation: ConversationWithStore,
  ): Promise<ParsedIntent> {
    const primaryModel = resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const result = await this.callParseIntent(
        text,
        conversation.currentState,
        primaryModel,
      );
      await this.logAiCall(
        conversation,
        'PARSE_INTENT',
        true,
        Date.now() - started,
      );
      return result;
    } catch {
      await this.logAiCall(
        conversation,
        'PARSE_INTENT',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return { intent: 'UNCLEAR' };
      const fallbackStarted = Date.now();
      try {
        const result = await this.callParseIntent(
          text,
          conversation.currentState,
          defaultModel(),
        );
        await this.logAiCall(
          conversation,
          'PARSE_INTENT',
          true,
          Date.now() - fallbackStarted,
        );
        return result;
      } catch {
        await this.logAiCall(
          conversation,
          'PARSE_INTENT',
          false,
          Date.now() - fallbackStarted,
        );
        return { intent: 'UNCLEAR' };
      }
    }
  }

  private async callCaption(facts: string, model: string): Promise<string> {
    const { text } = await generateText({
      model: this.aiProvider.buildClient()(model),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن.`,
      prompt: facts,
      temperature: 0.3,
    });
    return text.trim();
  }

  // بازنویسی نتیجه‌ی واقعی تول به یک پیام فارسی کوتاه — مدل هرگز چیزی غیر از دیتای واقعی
  // پاس‌داده‌شده را حدس نمی‌زند (طبق اصل امنیتی PAYMENT_INSTRUCTIONS، سند اجرایی بخش ۵.۳).
  // همان fallback دومرحله‌ای parseIntent را دارد
  private async caption(
    facts: string,
    conversation: ConversationWithStore,
  ): Promise<string> {
    const primaryModel = resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const text = await this.callCaption(facts, primaryModel);
      await this.logAiCall(conversation, 'CAPTION', true, Date.now() - started);
      return text;
    } catch {
      await this.logAiCall(
        conversation,
        'CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return facts;
      const fallbackStarted = Date.now();
      try {
        const text = await this.callCaption(facts, defaultModel());
        await this.logAiCall(
          conversation,
          'CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        return text;
      } catch {
        await this.logAiCall(
          conversation,
          'CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        return facts;
      }
    }
  }

  private async searchProducts(storeId: string, query?: string) {
    return this.prisma.product.findMany({
      where: {
        storeId,
        ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  private resolveProductRef(
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): { id: string; name: string } | null {
    if (parsed.productIndex) {
      return ctx.lastShownProducts?.[parsed.productIndex - 1] ?? null;
    }
    return null;
  }

  async handleMessage(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult> {
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: { text },
      },
    });

    const parsed = await this.parseIntent(text, conversation);
    const ctx = this.getContext(conversation);

    if (parsed.intent === 'REQUEST_HUMAN') {
      return this.transitionToHandoff(conversation, 'CUSTOMER_REQUESTED');
    }

    switch (parsed.intent) {
      case 'BROWSE':
        return this.doBrowse(conversation, parsed);
      case 'ADD_TO_CART':
      case 'REMOVE_FROM_CART':
        return this.doUpdateCart(conversation, ctx, parsed);
      case 'VIEW_CART':
        return this.doViewCart(conversation, ctx);
      case 'CHECKOUT':
      case 'CONFIRM':
        if (conversation.currentState === 'CART_REVIEW') {
          return this.doCreateOrder(conversation, ctx);
        }
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      case 'CANCEL':
        return this.doCancel(conversation);
      case 'ASK_FAQ':
        return this.doFaq(conversation);
      default:
        return this.doClarifyUnclear(conversation);
    }
  }

  // مسیر قطعی دکمه‌های UiBlock (افزودن به سبد/تایید سبد) — بدون NLU، productId از خودِ
  // دکمه معلوم است؛ فیدبک اول پایلوت: قبلاً این دکمه‌ها یک جمله‌ی فارسی می‌ساختند و دوباره
  // از parseIntent رد می‌شدند (گاهی «نامفهوم» تشخیص داده می‌شد)
  async handleAction(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    const ctx = this.getContext(conversation);

    if (action.type === 'ADD_TO_CART') {
      const product = action.productId
        ? await this.prisma.product.findUnique({
            where: { id: action.productId },
          })
        : null;
      if (!product || product.storeId !== conversation.storeId) {
        await this.prisma.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'CUSTOMER_MESSAGE',
            payload: { text: fa.salesAgent.addToCartAction },
          },
        });
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: fa.salesAgent.addToCartActionNamed(product.name) },
        },
      });
      return this.applyCartUpdate(
        conversation,
        ctx,
        product,
        action.qty ?? 1,
        false,
      );
    }

    // CONFIRM_CART
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: { text: fa.salesAgent.confirmCartAction },
      },
    });
    if (conversation.currentState !== 'CART_REVIEW') {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }
    return this.doCreateOrder(conversation, ctx);
  }

  // برای لینک اختصاصی یک محصول (?product=) — دقیقاً مثل doBrowse ولی بدون NLU، چون محصول
  // از قبل مشخص است (سلر لینکش را داده، نه پیام آزاد مشتری)
  async showProduct(
    conversation: ConversationWithStore,
    product: ProductLike,
  ): Promise<EngineResult> {
    const uiBlock: UiBlock = {
      type: 'PRODUCT_CARD',
      products: [
        {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          stock: product.stock,
          images: product.images,
        },
      ],
    };
    const nextState: ConversationState = 'BROWSING';
    await this.persistTransition(conversation, nextState, {
      cart: this.getContext(conversation).cart,
      lastShownProducts: [{ id: product.id, name: product.name }],
    });

    const reply = await this.caption(
      `مشتری از لینک مستقیم این محصول وارد شده: ${product.name} (${product.basePrice} تومان، موجودی ${product.stock})`,
      conversation,
    );
    const finalReply = `${fa.salesAgent.firstGreeting(conversation.store.name)}\n\n${reply}`;
    await this.logReply(conversation, finalReply, uiBlock);
    return { reply: finalReply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doBrowse(
    conversation: ConversationWithStore,
    parsed: ParsedIntent,
  ): Promise<EngineResult> {
    const products = await this.searchProducts(
      conversation.storeId,
      parsed.productQuery,
    );
    if (products.length === 0) {
      return this.doClarify(conversation, fa.salesAgent.noProductsFound);
    }

    const isFirstReply = conversation.currentState === 'GREETING';
    const uiBlock: UiBlock = {
      type: 'PRODUCT_CARD',
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        stock: p.stock,
        images: p.images,
      })),
    };
    const nextState: ConversationState = 'BROWSING';
    await this.persistTransition(conversation, nextState, {
      cart: this.getContext(conversation).cart,
      lastShownProducts: products.map((p) => ({ id: p.id, name: p.name })),
    });
    await this.resetClarifyAttempts(conversation);

    const reply = await this.caption(
      `این محصولات فروشگاه است: ${products.map((p) => `${p.name} (${p.basePrice} تومان، موجودی ${p.stock})`).join('، ')}`,
      conversation,
    );
    // فیدبک اول پایلوت: اولین پاسخ مکالمه (بعد از GREETING) یک خط راهنمای ثابت (نه
    // LLM-generated، برای پایداری) جلوی لیست محصولات می‌گیرد — قبلاً مشتری بدون هیچ
    // توضیحی مستقیم می‌رسید به لیست محصولات و نمی‌فهمید چیکار باید بکند
    const finalReply = isFirstReply
      ? `${fa.salesAgent.firstGreeting(conversation.store.name)}\n\n${reply}`
      : reply;
    await this.logReply(conversation, finalReply, uiBlock);
    return { reply: finalReply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doUpdateCart(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): Promise<EngineResult> {
    if (!['BROWSING', 'CART_REVIEW'].includes(conversation.currentState)) {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }

    const ref = this.resolveProductRef(ctx, parsed);
    const product = ref
      ? await this.prisma.product.findUnique({ where: { id: ref.id } })
      : parsed.productQuery
        ? (
            await this.searchProducts(conversation.storeId, parsed.productQuery)
          )[0]
        : null;

    if (!product || product.storeId !== conversation.storeId) {
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }

    return this.applyCartUpdate(
      conversation,
      ctx,
      product,
      parsed.quantity ?? 1,
      parsed.intent === 'REMOVE_FROM_CART',
    );
  }

  // منطق مشترک تغییر سبد — هم از مسیر NLU (doUpdateCart، productQuery/productIndex حدسی)
  // هم از مسیر قطعی دکمه‌ها (handleAction، productId مستقیم) صدا زده می‌شود
  private async applyCartUpdate(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: { id: string; name: string; basePrice: number; stock: number },
    qty: number,
    remove: boolean,
  ): Promise<EngineResult> {
    let cart = [...ctx.cart];
    const existingIdx = cart.findIndex((i) => i.productId === product.id);

    if (remove) {
      cart = cart.filter((i) => i.productId !== product.id);
    } else {
      if (product.stock < qty) {
        return this.doClarify(conversation, fa.salesAgent.insufficientStock);
      }
      if (existingIdx >= 0) {
        cart[existingIdx] = {
          ...cart[existingIdx],
          qty: cart[existingIdx].qty + qty,
        };
      } else {
        cart.push({
          productId: product.id,
          name: product.name,
          unitPrice: product.basePrice,
          qty,
        });
      }
    }

    const nextState: ConversationState = 'CART_REVIEW';
    await this.persistTransition(conversation, nextState, { ...ctx, cart });
    await this.resetClarifyAttempts(conversation);

    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: cart,
      total: this.cartTotal(cart),
    };
    const reply = await this.caption(
      cart.length
        ? `سبد فعلی: ${cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(cart)} تومان`
        : fa.salesAgent.cartEmpty,
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doViewCart(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: ctx.cart,
      total: this.cartTotal(ctx.cart),
    };
    const reply = await this.caption(
      ctx.cart.length
        ? `سبد فعلی: ${ctx.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(ctx.cart)} تومان`
        : fa.salesAgent.cartEmpty,
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  private async doCreateOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    if (ctx.cart.length === 0) {
      return this.doClarify(conversation, fa.salesAgent.cartEmpty);
    }

    // idempotent: اگر سفارش این مکالمه از قبل هست، همان را برمی‌گرداند (بدون ساخت تکراری)
    let order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    if (!order) {
      const total = this.cartTotal(ctx.cart);
      order = await this.prisma.order.create({
        data: {
          storeId: conversation.storeId,
          conversationId: conversation.id,
          items: ctx.cart,
          totalAmount: total,
        },
      });
    }

    const nextState: ConversationState = 'AWAITING_PAYMENT';
    await this.persistTransition(conversation, nextState, ctx, 'createOrder');

    const uiBlock: UiBlock = {
      type: 'PAYMENT_INSTRUCTIONS',
      cardNumber: conversation.store.bankCardNumber,
      ownerName: conversation.store.bankOwnerName,
      amount: order.totalAmount,
    };
    const reply = await this.caption(
      `سفارش ثبت شد. مبلغ قابل پرداخت ${order.totalAmount} تومان به شماره کارت ${conversation.store.bankCardNumber} به نام ${conversation.store.bankOwnerName}. بعد از واریز، عکس رسید را بفرست.`,
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  async handleReceiptUpload(
    conversation: ConversationWithStore,
    receiptImageKey: string,
  ): Promise<EngineResult> {
    const order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    if (!order || conversation.currentState !== 'AWAITING_PAYMENT') {
      return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { receiptImageKey, status: 'RECEIPT_SUBMITTED' },
    });

    const nextState: ConversationState = 'AWAITING_SELLER_APPROVAL';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      'submitReceipt',
    );

    const uiBlock: UiBlock = {
      type: 'ORDER_STATUS',
      orderId: order.id,
      status: 'RECEIPT_SUBMITTED',
    };
    const reply = await this.caption(
      fa.salesAgent.receiptReceived,
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doCancel(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    if (
      !['GREETING', 'BROWSING', 'CART_REVIEW'].includes(
        conversation.currentState,
      )
    ) {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }
    const nextState: ConversationState = 'BROWSING';
    await this.persistTransition(conversation, nextState, {
      cart: [],
      lastShownProducts: [],
    });
    await this.resetClarifyAttempts(conversation);
    const reply = await this.caption(fa.salesAgent.cartCleared, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: nextState };
  }

  // getStoreFaqAnswer فعلاً stub است (طبق ساده‌سازی پلن گام ۱) — بدون FaqEntry واقعی
  private async doFaq(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    const reply = await this.caption(fa.salesAgent.faqStub, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  private async doClarify(
    conversation: ConversationWithStore,
    hint: string,
  ): Promise<EngineResult> {
    const attempts = conversation.clarifyAttempts + 1;
    if (attempts >= HANDOFF_CLARIFY_THRESHOLD) {
      return this.transitionToHandoff(conversation, 'AGENT_STUCK');
    }
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { clarifyAttempts: attempts },
    });
    await this.logReply(conversation, hint, { type: 'NONE' });
    return { reply: hint, uiBlocks: [], state: conversation.currentState };
  }

  // فقط برای شاخه‌ی UNCLEAR واقعی (نه سایر doClarify هایی که پیام مشخص‌تری دارند مثل
  // «موجودی کافی نیست») — فیدبک اول پایلوت: راهنمای عمومی «متوجه نشدم» کافی نبود، اگر
  // لیست محصولاتی قبلاً نشان داده شده، نمونه‌ی اسم آن‌ها هم اضافه می‌شود
  private async doClarifyUnclear(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    const ctx = this.getContext(conversation);
    const names = ctx.lastShownProducts?.slice(0, 2).map((p) => p.name) ?? [];
    const hint = names.length
      ? fa.salesAgent.didNotUnderstandWithHint(names)
      : fa.salesAgent.didNotUnderstand;
    return this.doClarify(conversation, hint);
  }

  private async resetClarifyAttempts(conversation: ConversationWithStore) {
    if (conversation.clarifyAttempts > 0) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { clarifyAttempts: 0 },
      });
    }
  }

  private async transitionToHandoff(
    conversation: ConversationWithStore,
    reason: 'CUSTOMER_REQUESTED' | 'AGENT_STUCK',
  ): Promise<EngineResult> {
    const nextState: ConversationState = 'HANDOFF_HUMAN';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      reason,
    );
    const reply = fa.salesAgent.handoffToHuman;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: nextState };
  }

  // یک ConversationEvent(TOOL_CALL) + یک ConversationEvent(STATE_TRANSITION) + آپدیت
  // SalesConversation.currentState/contextData همگی در یک تراکنش (طبق پلن گام ۱)
  private async persistTransition(
    conversation: ConversationWithStore,
    nextState: ConversationState,
    context: ConversationContext,
    toolName?: string,
  ) {
    const fromState = conversation.currentState;
    await this.prisma.$transaction([
      ...(toolName
        ? [
            this.prisma.conversationEvent.create({
              data: {
                conversationId: conversation.id,
                type: 'TOOL_CALL',
                payload: { toolName },
              },
            }),
          ]
        : []),
      this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'STATE_TRANSITION',
          payload: { fromState, toState: nextState },
        },
      }),
      this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: {
          currentState: nextState,
          contextData: context,
          isMutedForHuman: nextState === 'HANDOFF_HUMAN' ? true : undefined,
        },
      }),
    ]);
    conversation.currentState = nextState;
  }

  private async logReply(
    conversation: ConversationWithStore,
    text: string,
    uiBlock: UiBlock,
  ) {
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AGENT_REPLY',
        payload: { text, uiBlock },
      },
    });
  }
}
