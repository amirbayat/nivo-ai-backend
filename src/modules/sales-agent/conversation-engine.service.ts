import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { ConversationState, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { StoreKbService } from '../store/store-kb.service';
import { CardSelectorService } from '../store/card-selector.service';
import { CreditService } from './credit.service';
import { AbuseGuardService } from './abuse-guard.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { CommentsService } from '../comments/comments.service';
import { fa } from '../../i18n/fa';
import { defaultModel, resolveModel } from './model-variants';
import { toneForCategory } from './tone-by-category';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from './intent-classification.schema';
import type {
  AiTraceData,
  BuyerNeedTag,
  CartItem,
  ConversationContext,
  EngineResult,
  ParsedIntent,
  SalesAction,
  SalesAgentVoiceJobData,
  UiBlock,
} from './sales-agent.types';

export type ConversationWithStore = Prisma.SalesConversationGetPayload<{
  include: { store: true };
}>;

type ProductLike = {
  id: string;
  name: string;
  basePrice: number;
  stock: number;
  images: string[];
  description?: string | null;
};

// آستانه‌ی handoff: بعد از این تعداد پیام پیاپی نامفهوم/بی‌نتیجه، مکالمه به انسان سپرده
// می‌شود (طبق جدول دیسپچ پلن گام ۱) — تایمر ندارد، فقط شمارنده.
// فیدبک اول پایلوت: از ۲ به ۴ افزایش یافت — ۲ خیلی زود escalate می‌کرد، مخصوصاً وقتی خودِ
// دکمه‌های UI هم (قبل از فیکس handleAction) از مسیر NLU رد می‌شدند و گاهی نامفهوم تشخیص
// داده می‌شدند
const HANDOFF_CLARIFY_THRESHOLD = 4;

// docs/PRD-sales-agent-voice.md بخش ۱.۳/۳ — آستانه‌ی طول پاسخ برای تولید وویس + سقف تعداد
// وویس به‌ازای هر مکالمه (جلوی مکالمه‌ای که هر پاسخش وویس می‌گیرد)
const VOICE_MIN_REPLY_CHARS = 200;
const VOICE_MAX_PER_CONVERSATION = 10;

// docs/PRD-sales-agent-voice.md بخش ۶.۲ — TTS پارامتر «حداکثر مدت» ندارد؛ با نرخ گفتار
// فارسی ~۱۴-۱۶ کاراکتر/ثانیه، ~۴۵۰ کاراکتر تقریباً معادل ۳۰ ثانیه است (تخمین اولیه، بعد
// از شنیدن نمونه‌ی واقعی قابل کالیبره‌شدن). متن ذخیره/نمایش‌داده‌شده کامل می‌ماند — فقط
// متنی که برای TTS صف می‌شود کوتاه می‌شود، و نه وسط جمله.
const VOICE_MAX_CHARS = 450;
const SENTENCE_END_CHARS = ['.', '!', '؟', '؛'];

function truncateForVoice(text: string): string {
  if (text.length <= VOICE_MAX_CHARS) return text;
  const window = text.slice(0, VOICE_MAX_CHARS);
  let cutAt = -1;
  for (const ch of SENTENCE_END_CHARS) {
    const idx = window.lastIndexOf(ch);
    if (idx > cutAt) cutAt = idx;
  }
  if (cutAt > 0) return text.slice(0, cutAt + 1);
  const lastSpace = window.lastIndexOf(' ');
  return lastSpace > 0 ? text.slice(0, lastSpace) : window;
}

@Injectable()
export class ConversationEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly storeKb: StoreKbService,
    private readonly cardSelector: CardSelectorService,
    private readonly creditService: CreditService,
    private readonly abuseGuard: AbuseGuardService,
    private readonly storage: StorageService,
    private readonly telegramApi: TelegramApiClientService,
    private readonly comments: CommentsService,
    @InjectQueue('sales-agent-voice')
    private readonly voiceQueue: Queue<SalesAgentVoiceJobData>,
  ) {}

  private getContext(conversation: ConversationWithStore): ConversationContext {
    const raw =
      conversation.contextData as unknown as ConversationContext | null;
    return {
      cart: raw?.cart ?? [],
      lastShownProducts: raw?.lastShownProducts ?? [],
      appliedDiscount: raw?.appliedDiscount ?? null,
    };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۶ — چند نظر تاییدشده‌ی اخیر یک محصول،
  // برای نشان‌دادن به خریدار بعدی (showProduct/doBrowse) به شکل یک خط واقعیت اضافه
  private async commentsFactsSuffix(productId: string): Promise<string> {
    const approved = await this.comments.getApprovedForProduct(productId, 2);
    if (approved.length === 0) return '';
    return `\nنظر خریدارهای قبلی: ${approved.map((c) => `«${c.text}»`).join('، ')}`;
  }

  private cartTotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }

  // یک ردیف آماری به‌ازای هر فراخوانی واقعی مدل (چه موفق، چه شکست‌خورده) — بخش C پلن
  // فیدبک اول پایلوت (A/B مدل‌ها)
  private async logAiCall(
    conversation: ConversationWithStore,
    kind: 'PARSE_INTENT' | 'CAPTION' | 'SATISFACTION_CLASSIFY',
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
  ): Promise<{
    result: ParsedIntent;
    inputTokens: number;
    outputTokens: number;
  }> {
    const { object, usage } = await generateObject({
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      // productQuery/productIndex/quantity عمداً .nullable() هستند نه .optional() — با
      // supportsStructuredOutputs=true، OpenAI حالت strict را روی این JSON schema اجرا می‌کند
      // که در آن *همه‌ی* کلیدها باید توی "required" باشند، حتی آن‌هایی که می‌توانند خالی
      // باشند؛ .optional() یعنی کلید از required حذف شود که در strict mode با 400 رد می‌شود
      // (دقیقاً همان الگوی مستندشده در nivo-cal.service.ts). قبل از این فیکس، هر فراخوانی
      // parseIntent (هم مدل اصلی هم فالبک) با همین خطا throw می‌کرد و بی‌صدا UNCLEAR
      // برمی‌گشت — یعنی موتور فروش هیچ پیامی را واقعاً طبقه‌بندی نمی‌کرد.
      // schema/prompt در intent-classification.schema.ts — تنها منبع واحد، sales-agent-qa.service.ts
      // (تست دقت intent) هم از همین‌جا می‌خواند تا دریفت بین این دو caller پیش نیاید
      schema: intentClassificationSchema,
      system: buildIntentClassificationPrompt(state),
      prompt: text,
    });
    return {
      result: object,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
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
      const { result, inputTokens, outputTokens } = await this.callParseIntent(
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
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
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
        const { result, inputTokens, outputTokens } =
          await this.callParseIntent(
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
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
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

  // docs/PRD-seller-credit-billing.md — نقطه‌ی مشترک لاگ مصرف متن، از هر سه call site واقعی
  // (parseIntent/caption/tryAnswerFromProductDescriptions) صدا زده می‌شود
  private async logTextCreditUsage(
    conversation: ConversationWithStore,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await this.creditService.logTextUsage({
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      billingMode: conversation.billingMode,
      model,
      inputTokens,
      outputTokens,
    });
  }

  private async callCaption(
    facts: string,
    model: string,
    category: string | null,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const tone = toneForCategory(category);
    const { text, usage } = await generateText({
      model: this.aiProvider.buildClient()(model),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هرگز تعداد دقیق موجودی
انبار را اعلام نکن (حتی اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
لحن نوشتار باید ${tone} باشد.`,
      prompt: facts,
      temperature: 0.3,
    });
    return {
      text: text.trim(),
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // بازنویسی نتیجه‌ی واقعی تول به یک پیام فارسی کوتاه — مدل هرگز چیزی غیر از دیتای واقعی
  // پاس‌داده‌شده را حدس نمی‌زند (طبق اصل امنیتی PAYMENT_INSTRUCTIONS، سند اجرایی بخش ۵.۳).
  // همان fallback دومرحله‌ای parseIntent را دارد
  private async caption(
    facts: string,
    conversation: ConversationWithStore,
  ): Promise<string> {
    const primaryModel = resolveModel(conversation.abVariant);
    const category = conversation.store.category;
    const started = Date.now();
    try {
      const { text, inputTokens, outputTokens } = await this.callCaption(
        facts,
        primaryModel,
        category,
      );
      await this.logAiCall(conversation, 'CAPTION', true, Date.now() - started);
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
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
        const { text, inputTokens, outputTokens } = await this.callCaption(
          facts,
          defaultModel(),
          category,
        );
        await this.logAiCall(
          conversation,
          'CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
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

  private async searchProducts(storeId: string, query?: string | null) {
    // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد محصول (روی محتوای تبلیغاتی) قبل از
    // جستجوی نام امتحان می‌شود؛ اگر دقیقاً مچ شد، فقط همان یکی برگردانده می‌شود
    if (query) {
      const exact = await this.prisma.product.findFirst({
        where: { storeId, code: { equals: query, mode: 'insensitive' } },
      });
      if (exact) return [exact];
    }
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

  // docs/PRD-buyer-preference-personalization.md §۹.۳
  private async recordBuyerNeedCounts(
    customerId: string,
    tags: BuyerNeedTag[],
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { buyerNeedCounts: true },
    });
    const counts = {
      ...((customer?.buyerNeedCounts as Record<string, number> | null) ?? {}),
    };
    for (const tag of tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { buyerNeedCounts: counts },
    });
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

    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

    // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — بعد از تایید سفارش (COMPLETED)
    // یک پیام پیگیری باز می‌شود؛ اولین پیام آزاد بعدی مستقیم متن نظر می‌شود، بدون فراخوان AI
    // (نه parseIntent، نه هزینه‌ای برای فروشگاه)
    const awaitingReview = (
      conversation.contextData as {
        awaitingReview?: boolean;
        awaitingReviewProductId?: string | null;
      } | null
    )?.awaitingReview;
    if (conversation.currentState === 'COMPLETED' && awaitingReview) {
      return this.doSubmitComment(conversation, text);
    }

    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — فالوآپ رضایت (چند روز بعد، صف
    // PostPurchaseFollowUpService) این فلگ را ست کرده؛ اولین پیام آزاد بعدی *احتمالاً* جواب
    // همان سؤال است، ولی doSatisfactionReply خودش با AI چک می‌کند که واقعاً همین‌طور است یا نه
    // (مثلاً ممکن است مشتری بعد از چند روز یک درخواست خرید کاملاً جدید فرستاده باشد) — اگر
    // بی‌ربط تشخیص داد null برمی‌گرداند تا پیام از مسیر عادی (پایین همین متد) پردازش شود
    const awaitingSatisfactionCheck = (
      conversation.contextData as { awaitingSatisfactionCheck?: boolean } | null
    )?.awaitingSatisfactionCheck;
    if (
      conversation.currentState === 'COMPLETED' &&
      awaitingSatisfactionCheck
    ) {
      const satisfactionResult = await this.doSatisfactionReply(
        conversation,
        text,
      );
      if (satisfactionResult) return satisfactionResult;
    }

    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

    const parsed = await this.parseIntent(text, conversation);
    const ctx = this.getContext(conversation);

    // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۴.۲ — trace سطح classification، جدا از
    // trace های اختصاصی هر handler در logReply؛ چون بلافاصله بعد از CUSTOMER_MESSAGE و قبل از
    // هر AGENT_REPLY نوشته می‌شود، getConversationTrace فعلی (که trace را به AGENT_REPLY بعدش
    // می‌چسباند) این را نادیده می‌گیرد نه خراب می‌کند — نمایش در ادمین یک گام بعدی جداست
    // شرط ثبت عمداً intentConfidence!=='HIGH' را هم شامل می‌شود (نه فقط buyerNeeds/unmatched) —
    // این دقیقاً سیگنالی است که بخش «Potential misclassification» بخش ۵.۱ سند به آن نیاز داشت،
    // مستقل از اینکه پیام اصلاً buyerNeeds شناخته‌شده‌ای هم داشته باشد یا نه
    if (
      parsed.buyerNeeds?.length ||
      parsed.unmatchedBuyerNeed ||
      (parsed.intentConfidence && parsed.intentConfidence !== 'HIGH')
    ) {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AI_TRACE',
          payload: {
            intent: parsed.intent,
            handler: 'parseIntent',
            buyerNeeds: parsed.buyerNeeds ?? [],
            ...(parsed.unmatchedBuyerNeed
              ? { unmatchedBuyerNeed: parsed.unmatchedBuyerNeed }
              : {}),
            ...(parsed.intentConfidence
              ? { intentConfidence: parsed.intentConfidence }
              : {}),
          },
        },
      });
    }

    // docs/PRD-buyer-preference-personalization.md §۹.۳ — فاز ۱: فقط تجمیع، هیچ رفتار
    // ایجنتی از رویش تصمیم نمی‌گیرد. عمداً read-merge-write ساده (نه raw SQL atomic
    // increment) — این یک شمارنده‌ی تحلیلی کم‌ریسک است، نه داده‌ی مالی؛ پیام‌های یک مشتری
    // هم عملاً پشت‌سرهم می‌آیند، نه هم‌زمان
    if (parsed.buyerNeeds?.length) {
      await this.recordBuyerNeedCounts(
        conversation.customerId,
        parsed.buyerNeeds,
      );
    }

    // همان سند، بخش ۲ — گروه‌های P1 (پرداخت/پس از خرید): ربات فعلاً Tool ای برای حل این‌ها
    // ندارد، پس به‌جای پاسخ نصفه‌ونیمه‌ی ASK_FAQ، مستقیم به فروشنده ارجاع می‌شود. اولویت روی
    // REQUEST_HUMAN صریح نیست چون این چک زودتر (بالا) رد شده — یعنی اگر مشتری هم صریح انسان
    // خواسته باشد هم مشکل پرداخت مطرح کرده، همان مسیر REQUEST_HUMAN می‌رود، تکراری نمی‌شود
    if (
      parsed.buyerNeeds?.includes('PAYMENT_ISSUE') ||
      parsed.buyerNeeds?.includes('POST_PURCHASE_SUPPORT')
    ) {
      return this.transitionToHandoff(conversation, 'SUPPORT_NEEDED');
    }

    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — قبلاً «عکس بیشتر بده»/«چه شکلیه؟»
    // یا به ASK_FAQ می‌رفت (که اصلاً uiBlock نمی‌فرستد) یا حداکثر از PRODUCT_CARD موجود یک
    // عکس (images[0]) می‌گرفت. فقط وقتی محصول قابل‌شناسایی باشد وارد می‌شویم؛ وگرنه جریان
    // عادی (switch پایین) همان مسیر همیشگی‌اش را می‌رود. اکشن‌های قطعی (پرداخت/لغو/تخفیف) را
    // عمداً رد می‌کند تا عکس‌خواهی حین آن‌ها جریان تصمیم‌گیری را منحرف نکند
    if (
      parsed.buyerNeeds?.includes('REQUEST_MORE_PHOTOS') &&
      !['CHECKOUT', 'CONFIRM', 'CANCEL', 'APPLY_DISCOUNT'].includes(
        parsed.intent,
      )
    ) {
      const photosResult = await this.doShowPhotos(conversation, ctx, parsed);
      if (photosResult) return photosResult;
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
        return this.doFaq(conversation, text, ctx);
      case 'APPLY_DISCOUNT':
        if (conversation.currentState === 'CART_REVIEW') {
          return this.doApplyDiscount(conversation, ctx, parsed.discountCode);
        }
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      default:
        return this.doClarifyUnclear(conversation);
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — همان منطق شناسایی محصول doUpdateCart
  // (ایندکس صریح از lastShownProducts، وگرنه جستجوی نام). null یعنی «محصول قابل‌شناسایی نبود»؛
  // handleMessage در این حالت جریان عادی (switch) را ادامه می‌دهد، نه یک پیام خطای جدا درباره‌ی
  // عکس — چون intent اصلی (مثلاً ASK_FAQ) همچنان باید جواب خودش را بدهد
  private async doShowPhotos(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): Promise<EngineResult | null> {
    const ref = this.resolveProductRef(ctx, parsed);
    const product = ref
      ? await this.prisma.product.findUnique({ where: { id: ref.id } })
      : parsed.productQuery
        ? (
            await this.searchProducts(conversation.storeId, parsed.productQuery)
          )[0]
        : null;
    if (!product || product.storeId !== conversation.storeId) return null;
    if (product.images.length === 0) return null;

    const uiBlock: UiBlock = {
      type: 'PRODUCT_PHOTOS',
      productId: product.id,
      productName: product.name,
      images: product.images,
    };
    const reply = fa.salesAgent.photosCaption(product.name);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: parsed.intent,
      handler: 'doShowPhotos',
      factsOrPrompt: product.name,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — همان متن آزاد مشتری، بدون هیچ NLU،
  // مستقیم یک ProductComment (PENDING) می‌شود؛ awaitingReview پاک می‌شود تا پیام بعدی دوباره
  // نظر تلقی نشود
  private async doSubmitComment(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult> {
    const existingContext = (conversation.contextData ??
      {}) as Prisma.JsonObject & {
      awaitingReviewProductId?: string | null;
    };
    const productId = existingContext.awaitingReviewProductId ?? null;

    await this.comments.submitComment({
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      productId,
      text,
    });

    const { awaitingReview, awaitingReviewProductId, ...rest } =
      existingContext;
    void awaitingReview;
    void awaitingReviewProductId;
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { contextData: rest },
    });

    const reply = fa.salesAgent.reviewThanks;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — طبقه‌بندی جواب مشتری به فالوآپ رضایت.
  // نسخه‌ی اول این هیورستیک کلیدواژه‌ی ساده بود (مثلاً .includes('مشکل')) ولی فالس‌پازیتیو
  // واقعی داشت («مشکلی نداشتم، همه چیز عالی بود» را منفی تشخیص می‌داد چون منفی‌سازی جمله را
  // نمی‌فهمید) — جایگزین شد با یک فراخوان AI بسیار کوچک که هم منفی‌سازی را می‌فهمد هم اصلاً
  // تشخیص می‌دهد که پیام واقعاً جواب این سؤال هست یا نه (UNRELATED)
  private async callSatisfactionClassify(
    text: string,
    model: string,
  ): Promise<{
    verdict: 'POSITIVE' | 'NEGATIVE' | 'UNRELATED';
    inputTokens: number;
    outputTokens: number;
  }> {
    const { object, usage } = await generateObject({
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      schema: z.object({
        verdict: z.enum(['POSITIVE', 'NEGATIVE', 'UNRELATED']),
      }),
      system: `چند روز پیش این مشتری از یک فروشگاه اینستاگرامی خرید کرده و همین الان این پیام
برایش فرستاده شده: «چند روزی از خریدت گذشته — همه‌چیز خوب بود؟». پیام زیر جواب مشتری به همین
سؤال است. یکی از این سه حالت را تشخیص بده:
- POSITIVE: راضی بوده/مشکلی نداشته (حتی اگر با جمله‌ی منفی مثل «مشکلی نبود» یا «بد نبود» بیان
  شده باشد — منفی‌سازی جمله را در نظر بگیر، نه فقط وجود کلمه‌ی منفی)
- NEGATIVE: از خرید/محصول/ارسال ناراضی بوده یا مشکل واقعی مطرح کرده
- UNRELATED: پیام اصلاً جواب این سؤال نیست — مثلاً می‌خواهد چیز دیگری بخرد، سؤال تازه‌ای دارد،
  یا کلاً بی‌ربط به رضایت از این خرید است
فقط JSON مطابق schema برگردان.`,
      prompt: text,
    });
    return {
      verdict: object.verdict,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // همان الگوی fallback دومرحله‌ای parseIntent/caption؛ اگر هر دو تلاش شکست خورد، امن‌ترین
  // پیش‌فرض UNRELATED است (نه POSITIVE/NEGATIVE حدسی) — یعنی پیام از مسیر عادی پردازش می‌شود
  // به‌جای اینکه با یک نتیجه‌ی حدسی به فروشنده یا مشتری جواب غلط داده شود
  private async classifySatisfactionReply(
    text: string,
    conversation: ConversationWithStore,
  ): Promise<'POSITIVE' | 'NEGATIVE' | 'UNRELATED'> {
    const primaryModel = resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const { verdict, inputTokens, outputTokens } =
        await this.callSatisfactionClassify(text, primaryModel);
      await this.logAiCall(
        conversation,
        'SATISFACTION_CLASSIFY',
        true,
        Date.now() - started,
      );
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return verdict;
    } catch {
      await this.logAiCall(
        conversation,
        'SATISFACTION_CLASSIFY',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return 'UNRELATED';
      const fallbackStarted = Date.now();
      try {
        const { verdict, inputTokens, outputTokens } =
          await this.callSatisfactionClassify(text, defaultModel());
        await this.logAiCall(
          conversation,
          'SATISFACTION_CLASSIFY',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return verdict;
      } catch {
        await this.logAiCall(
          conversation,
          'SATISFACTION_CLASSIFY',
          false,
          Date.now() - fallbackStarted,
        );
        return 'UNRELATED';
      }
    }
  }

  // null برمی‌گرداند یعنی «این پیام جواب رضایت نبود» — handleMessage در این حالت باید همان
  // پیام را از مسیر عادی (parseIntent/doBrowse/...) رد کند، نه اینکه بی‌صدا گمش کند
  private async doSatisfactionReply(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult | null> {
    const existingContext = (conversation.contextData ??
      {}) as Prisma.JsonObject & { awaitingSatisfactionCheck?: boolean };
    const { awaitingSatisfactionCheck, ...rest } = existingContext;
    void awaitingSatisfactionCheck;

    // بدون اعتبار، حتی برای طبقه‌بندی هم AI صدا زده نمی‌شود — می‌گذاریم جریان عادی (که خودش
    // بلافاصله بعد از این چک وارد billingBlocked می‌شود و handoff می‌کند) پیام را ببیند
    if (this.billingBlocked(conversation)) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { contextData: rest },
      });
      return null;
    }

    const verdict = await this.classifySatisfactionReply(text, conversation);

    if (verdict === 'UNRELATED') {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { contextData: rest },
      });
      return null;
    }

    const negative = verdict === 'NEGATIVE';
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: {
        contextData: rest,
        ...(negative ? { isMutedForHuman: true } : {}),
      },
    });

    const reply = negative
      ? fa.salesAgent.satisfactionNegativeAck
      : fa.salesAgent.satisfactionThanksAck;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش ۹ — فقط پیش‌نمایش/اعتبارسنجی؛ مصرف واقعی
  // (atomic increment) در doCreateOrder اتفاق می‌افتد، چون ممکن است خریدار قبل از پرداخت پشیمان شود
  private async doApplyDiscount(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    rawCode: string | null | undefined,
  ): Promise<EngineResult> {
    if (!rawCode) {
      return this.doClarify(conversation, fa.salesAgent.discountCodeMissing);
    }
    const normalized = rawCode.trim().toUpperCase();
    const discount = await this.prisma.storeDiscountCode.findFirst({
      where: {
        storeId: conversation.storeId,
        code: normalized,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    const valid =
      discount &&
      (discount.maxRedemptions == null ||
        discount.redemptionCount < discount.maxRedemptions);
    if (!valid) {
      return this.doClarify(conversation, fa.salesAgent.discountCodeInvalid);
    }

    const total = this.cartTotal(ctx.cart);
    const amountToman =
      discount.kind === 'PERCENT'
        ? Math.floor((total * discount.value) / 100)
        : Math.min(discount.value, total);

    const nextCtx: ConversationContext = {
      ...ctx,
      appliedDiscount: { id: discount.id, code: discount.code, amountToman },
    };
    await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);

    const newTotal = total - amountToman;
    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: ctx.cart,
      total: newTotal,
    };
    const facts = `کد تخفیف ${normalized} اعمال شد — ${amountToman} تومان تخفیف. جمع جدید سبد: ${newTotal} تومان`;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'APPLY_DISCOUNT',
      handler: 'doApplyDiscount',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: 'CART_REVIEW' };
  }

  // مسیر قطعی دکمه‌های UiBlock (افزودن به سبد/تایید سبد) — بدون NLU، productId از خودِ
  // دکمه معلوم است؛ فیدبک اول پایلوت: قبلاً این دکمه‌ها یک جمله‌ی فارسی می‌ساختند و دوباره
  // از parseIntent رد می‌شدند (گاهی «نامفهوم» تشخیص داده می‌شد)
  async handleAction(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

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
        'ADD_TO_CART',
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

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۲ — اگر همین Customer (نه همین مکالمه، چون
  // «گفتگوی جدید»/رستارت مکالمه‌ی تازه می‌سازد) قبلاً یک سفارش APPROVED از این فروشگاه داشته،
  // پیام خوش‌آمد اول عوض می‌شود؛ فقط از دیتای موجود (Order)، بدون زیرساخت تازه
  private async buildGreeting(
    conversation: ConversationWithStore,
  ): Promise<string> {
    const previousOrder = await this.prisma.order.findFirst({
      where: {
        status: 'APPROVED',
        conversation: {
          customerId: conversation.customerId,
          id: { not: conversation.id },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!previousOrder)
      return fa.salesAgent.firstGreeting(conversation.store.name);

    const items = previousOrder.items as { name: string }[];
    const productName = items[0]?.name;
    if (!productName)
      return fa.salesAgent.firstGreeting(conversation.store.name);

    return fa.salesAgent.returningGreeting(
      conversation.store.name,
      productName,
    );
  }

  // برای لینک اختصاصی یک محصول (?product=) — دقیقاً مثل doBrowse ولی بدون NLU، چون محصول
  // از قبل مشخص است (سلر لینکش را داده، نه پیام آزاد مشتری)
  async showProduct(
    conversation: ConversationWithStore,
    product: ProductLike,
  ): Promise<EngineResult> {
    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

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

    // عمداً بدون عدد موجودی در واقعیت‌هایی که به مدل داده می‌شود — caption() فقط از همین
    // واقعیت‌ها جمله می‌سازد، پس هر عددی اینجا باشد عیناً به مشتری گفته می‌شود. فروشنده
    // نمی‌خواهد تعداد واقعی موجودی افشا شود؛ فقط وضعیت موجود/ناموجود کافی است.
    const facts = `مشتری از لینک مستقیم این محصول وارد شده: ${product.name} (${product.basePrice} تومان)${product.stock === 0 ? ' — فعلاً ناموجود' : ''}${product.description ? `\nتوضیحات محصول: ${product.description}` : ''}${await this.commentsFactsSuffix(product.id)}`;
    const reply = await this.caption(facts, conversation);
    const finalReply = `${await this.buildGreeting(conversation)}\n\n${reply}`;
    await this.logReply(conversation, finalReply, uiBlock, undefined, {
      intent: 'BROWSE',
      handler: 'showProduct',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply: finalReply, uiBlocks: [uiBlock], state: nextState };
  }

  // برای /start تلگرام (docs/PRD-telegram-bot-channel.md بخش ۴.۱) — همان مسیر BROWSE بدون
  // NLU، دقیقاً معادل اولین پیام «محصولات رو نشون بده» یک مکالمه‌ی تازه
  async startBrowse(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }
    return this.doBrowse(conversation, { intent: 'BROWSE' });
  }

  // docs/PRD-seller-credit-billing.md — وقتی همان لحظه‌ی ساخت مکالمه (startChat وب) معلوم شد
  // BLOCKED است، اولین پاسخ باید مستقیم همین پیام ثابت باشد، نه یک CUSTOMER_MESSAGE ساختگی خالی
  async announceBillingBlocked(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
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

    // همون دلیل showProduct بالا — بدون عدد موجودی در واقعیت‌ها
    const facts = `این محصولات فروشگاه است: ${products.map((p) => `${p.name} (${p.basePrice} تومان)${p.stock === 0 ? ' — فعلاً ناموجود' : ''}${p.description ? ` — توضیحات: ${p.description}` : ''}`).join('، ')}`;
    const reply = await this.caption(facts, conversation);
    // فیدبک اول پایلوت: اولین پاسخ مکالمه (بعد از GREETING) یک خط راهنمای ثابت (نه
    // LLM-generated، برای پایداری) جلوی لیست محصولات می‌گیرد — قبلاً مشتری بدون هیچ
    // توضیحی مستقیم می‌رسید به لیست محصولات و نمی‌فهمید چیکار باید بکند
    const finalReply = isFirstReply
      ? `${await this.buildGreeting(conversation)}\n\n${reply}`
      : reply;
    await this.logReply(conversation, finalReply, uiBlock, undefined, {
      intent: parsed.intent,
      handler: 'doBrowse',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
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
      parsed.intent,
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
    intent: string,
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
    const facts = cart.length
      ? `سبد فعلی: ${cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(cart)} تومان\n${fa.salesAgent.discountAppliedHint}`
      : fa.salesAgent.cartEmpty;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent,
      handler: 'applyCartUpdate',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
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
    const facts = ctx.cart.length
      ? `سبد فعلی: ${ctx.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(ctx.cart)} تومان`
      : fa.salesAgent.cartEmpty;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'VIEW_CART',
      handler: 'doViewCart',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
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
    let cardNumber: string;
    let ownerName: string;
    if (!order) {
      const cartTotal = this.cartTotal(ctx.cart);
      // docs/PRD-customer-comments-and-discounts.md بخش ۹ — مصرف واقعی کد تخفیف همین‌جا،
      // نه در doApplyDiscount (پیش‌نمایش)؛ UPDATE شرطی خام (نه updateMany) چون شرط سقف
      // (redemptionCount < maxRedemptions) مقایسه‌ی دو ستون همین ردیف است — چیزی که فیلتر
      // Prisma نمی‌تواند بدون رفتن به raw SQL بیان کند. لاک ردیف پستگرس خودش اتمیک‌بودن را
      // تضمین می‌کند: دو خریدار هم‌زمان نمی‌توانند هردو از آخرین ظرفیت کد استفاده کنند.
      let discountAmount = 0;
      let discountCodeId: string | undefined;
      if (ctx.appliedDiscount) {
        const affected = await this.prisma.$executeRaw`
          UPDATE store_discount_codes
          SET "redemptionCount" = "redemptionCount" + 1
          WHERE id = ${ctx.appliedDiscount.id}
            AND "isActive" = true
            AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
        `;
        if (affected > 0) {
          discountAmount = ctx.appliedDiscount.amountToman;
          discountCodeId = ctx.appliedDiscount.id;
        }
      }
      const total = cartTotal - discountAmount;
      // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲ — انتخاب دقیقاً همین لحظه، یک‌بار،
      // و روی خودِ سفارش پرسیست می‌شود (بازخوانی بعدی همین سفارش دوباره انتخاب نمی‌کند)
      const card = await this.cardSelector.selectCard(conversation.storeId);
      order = await this.prisma.order.create({
        data: {
          storeId: conversation.storeId,
          conversationId: conversation.id,
          items: ctx.cart,
          totalAmount: total,
          bankCardId: card.id,
          discountCodeId,
        },
      });
      cardNumber = card.cardNumber;
      ownerName = card.ownerName;
    } else if (order.bankCardId) {
      const card = await this.prisma.storeBankCard.findUnique({
        where: { id: order.bankCardId },
      });
      cardNumber = card?.cardNumber ?? conversation.store.bankCardNumber;
      ownerName = card?.ownerName ?? conversation.store.bankOwnerName;
    } else {
      cardNumber = conversation.store.bankCardNumber;
      ownerName = conversation.store.bankOwnerName;
    }

    const nextState: ConversationState = 'AWAITING_PAYMENT';
    await this.persistTransition(conversation, nextState, ctx, 'createOrder');

    const uiBlock: UiBlock = {
      type: 'PAYMENT_INSTRUCTIONS',
      cardNumber,
      ownerName,
      amount: order.totalAmount,
    };
    const facts = `سفارش ثبت شد. مبلغ قابل پرداخت ${order.totalAmount} تومان به شماره کارت ${cardNumber} به نام ${ownerName}. بعد از واریز، عکس رسید را بفرست.`;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'CHECKOUT',
      handler: 'doCreateOrder',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
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
    await this.notifySellerOfReceipt(conversation, order.id, receiptImageKey);
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — عکس رسید از پشت JwtGuard+مالکیت سرو می‌شود،
  // پس سرور تلگرام نمی‌تواند خودش آن را fetch کند؛ بایت‌های واقعی multipart آپلود می‌شوند
  private async notifySellerOfReceipt(
    conversation: ConversationWithStore,
    orderId: string,
    receiptImageKey: string,
  ): Promise<void> {
    const chatId = conversation.store.ownerTelegramChatId;
    if (!chatId) return;
    const ext = receiptImageKey.split('.').pop() ?? 'jpg';
    const buffer = await this.storage.downloadImage(receiptImageKey);
    await this.telegramApi.sendPhotoBuffer(
      chatId,
      buffer,
      `receipt.${ext}`,
      mimeTypeForExt(ext),
      fa.telegram.receiptNotificationCaption,
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.receiptApproveButton,
              callback_data: `sap:${orderId}`,
            },
            {
              text: fa.telegram.receiptRejectButton,
              callback_data: `srj:${orderId}`,
            },
          ],
        ],
      },
    );
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
    const facts = fa.salesAgent.cartCleared;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' }, undefined, {
      intent: 'CANCEL',
      handler: 'doCancel',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [], state: nextState };
  }

  // getStoreFaqAnswer فعلاً stub است (طبق ساده‌سازی پلن گام ۱) — بدون FaqEntry واقعی
  // باکس دانش فروشگاه (docs/PRD-seller-knowledge-base.md بخش ۴) — اگر جواب واقعی پیدا شد،
  // caption() آن را با لحن فروشگاه بازنویسی می‌کند؛ اگر نه، قبل از stub، توضیح محصولاتی که
  // اخیراً به مشتری نشان داده شده امتحان می‌شود (فروشنده‌ها معمولاً توضیح محصول را دارند ولی
  // باکس دانش را جدا پر نمی‌کنند) — فقط اگر جواب واقعی از همان توضیح پیدا شد استفاده می‌شود؛
  // اگر نه، همان stub قبلی + flag برای ریپورت ادمین
  private async doFaq(
    conversation: ConversationWithStore,
    question: string,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    const match = await this.storeKb.retrieveRelevant(
      conversation.storeId,
      question,
    );
    if (match) {
      const facts = `سؤال مشتری: ${match.question}\nجواب واقعی: ${match.answer}`;
      const reply = await this.caption(facts, conversation);
      await this.logReply(conversation, reply, { type: 'NONE' }, undefined, {
        intent: 'ASK_FAQ',
        handler: 'doFaq',
        factsOrPrompt: facts,
        model: resolveModel(conversation.abVariant),
        kbSource: 'STORE_KB',
      });
      return { reply, uiBlocks: [], state: conversation.currentState };
    }

    const fromDescription = await this.tryAnswerFromProductDescriptions(
      conversation,
      ctx,
      question,
    );
    if (fromDescription) {
      // این مسیر مستقیم generateObject خودش را دارد (نه caption()) و همیشه با defaultModel()
      // صدا زده می‌شود، نه resolveModel(abVariant) — طبق پیاده‌سازی واقعی tryAnswerFromProductDescriptions
      await this.logReply(
        conversation,
        fromDescription,
        { type: 'NONE' },
        undefined,
        {
          intent: 'ASK_FAQ',
          handler: 'doFaq',
          factsOrPrompt: question,
          model: defaultModel(),
          kbSource: 'PRODUCT_DESCRIPTION',
        },
      );
      return {
        reply: fromDescription,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }

    const fromStoreProfile = await this.tryAnswerFromStoreProfile(
      conversation,
      question,
    );
    if (fromStoreProfile) {
      await this.logReply(
        conversation,
        fromStoreProfile,
        { type: 'NONE' },
        undefined,
        {
          intent: 'ASK_FAQ',
          handler: 'doFaq',
          factsOrPrompt: question,
          model: defaultModel(),
          kbSource: 'STORE_PROFILE',
        },
      );
      return {
        reply: fromStoreProfile,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }

    const reply = await this.caption(fa.salesAgent.faqStub, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' }, 'NO_KB_MATCH', {
      intent: 'ASK_FAQ',
      handler: 'doFaq',
      factsOrPrompt: fa.salesAgent.faqStub,
      model: resolveModel(conversation.abVariant),
      kbSource: 'STUB',
    });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // فقط محصولاتی که همین الان به مشتری نشان داده شده‌اند (lastShownProducts) — حدس‌زدن محصول
  // مورد نظر از روی کل کاتالوگ ریسک جواب غلط دارد. اگر توضیح آن محصولات هم چیزی نداشت که به
  // سؤال بخورد، null برمی‌گردد (مدل صریح باید بگوید answered=false، نه اینکه جواب اختراع کند)
  private async tryAnswerFromProductDescriptions(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    question: string,
  ): Promise<string | null> {
    const recentIds = ctx.lastShownProducts?.map((p) => p.id) ?? [];
    if (recentIds.length === 0) return null;

    const products = await this.prisma.product.findMany({
      where: { id: { in: recentIds }, storeId: conversation.storeId },
      select: { name: true, description: true },
    });
    const withDescription = products.filter(
      (p): p is { name: string; description: string } =>
        !!p.description?.trim(),
    );
    if (withDescription.length === 0) return null;

    try {
      const tone = toneForCategory(conversation.store.category);
      const model = defaultModel();
      const { object, usage } = await generateObject({
        model: this.aiProvider.buildClient()(model),
        schema: z.object({ answered: z.boolean(), reply: z.string() }),
        system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. زیر توضیح چند محصول
(نوشته‌ی خودِ فروشنده) را داری. اگر واقعاً می‌شود از همین توضیحات به سؤال مشتری جواب داد،
answered=true و یک پیام فارسی کوتاه (۲-۳ جمله، لحن ${tone}) بده — هیچ چیزی (قیمت/موجودی/مشخصات)
که در توضیحات نیامده حدس نزن یا اختراع نکن. اگر توضیحات ربطی به این سؤال ندارد یا کافی نیست،
answered=false بده (به‌جای حدس‌زدن).`,
        prompt: `توضیح محصولات:\n${withDescription.map((p) => `${p.name}: ${p.description}`).join('\n')}\n\nسؤال مشتری: ${question}`,
      });
      await this.logTextCreditUsage(
        conversation,
        model,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      return object.answered ? object.reply.trim() : null;
    } catch {
      return null;
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه
  // (ارسال/مرجوعی/معرفی برند)، همیشه در دسترس بدون نیاز به retrieval روی باکس دانش. دقیقاً
  // الگوی tryAnswerFromProductDescriptions: یک فراخوان ارزان تصمیم می‌گیرد آیا واقعاً جواب
  // این سؤال است، هیچ‌چیز فراتر از همین سه فیلد حدس زده نمی‌شود
  private async tryAnswerFromStoreProfile(
    conversation: ConversationWithStore,
    question: string,
  ): Promise<string | null> {
    const { shippingInfo, returnPolicy, brandIntro } = conversation.store;
    if (!shippingInfo && !returnPolicy && !brandIntro) return null;

    const facts = [
      shippingInfo && `ارسال/هزینه‌ی ارسال: ${shippingInfo}`,
      returnPolicy && `شرایط مرجوعی/گارانتی: ${returnPolicy}`,
      brandIntro && `معرفی فروشگاه: ${brandIntro}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const tone = toneForCategory(conversation.store.category);
      const model = defaultModel();
      const { object, usage } = await generateObject({
        model: this.aiProvider.buildClient()(model),
        schema: z.object({ answered: z.boolean(), reply: z.string() }),
        system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. زیر چند واقعیت ثابت
درباره‌ی خودِ فروشگاه (نه یک محصول خاص) را داری. اگر واقعاً می‌شود از همین واقعیت‌ها به سؤال
مشتری جواب داد، answered=true و یک پیام فارسی کوتاه (۱-۲ جمله، لحن ${tone}) بده — هیچ چیزی که
اینجا نیامده حدس نزن یا اختراع نکن. اگر ربطی به این سؤال ندارد یا کافی نیست، answered=false بده.`,
        prompt: `اطلاعات فروشگاه:\n${facts}\n\nسؤال مشتری: ${question}`,
      });
      await this.logTextCreditUsage(
        conversation,
        model,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      return object.answered ? object.reply.trim() : null;
    } catch {
      return null;
    }
  }

  private async doClarify(
    conversation: ConversationWithStore,
    hint: string,
    flag?: 'UNCLEAR',
  ): Promise<EngineResult> {
    const attempts = conversation.clarifyAttempts + 1;
    if (attempts >= HANDOFF_CLARIFY_THRESHOLD) {
      return this.transitionToHandoff(conversation, 'AGENT_STUCK');
    }
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { clarifyAttempts: attempts },
    });
    await this.logReply(conversation, hint, { type: 'NONE' }, flag);
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
    return this.doClarify(conversation, hint, 'UNCLEAR');
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
    reason:
      | 'CUSTOMER_REQUESTED'
      | 'AGENT_STUCK'
      | 'BILLING_BLOCKED'
      // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۲ — گروه‌های P1 (PAYMENT_ISSUE/
      // POST_PURCHASE_SUPPORT در buyerNeeds)؛ ربات Tool ای برای این‌ها ندارد، مستقیم ارجاع
      | 'SUPPORT_NEEDED',
  ): Promise<EngineResult> {
    const nextState: ConversationState = 'HANDOFF_HUMAN';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      reason,
    );
    const reply =
      reason === 'BILLING_BLOCKED'
        ? fa.salesAgent.billingBlockedHandoff
        : reason === 'SUPPORT_NEEDED'
          ? fa.salesAgent.supportNeededHandoff
          : this.isWithinWorkingHours(conversation.store)
            ? fa.salesAgent.handoffToHuman
            : fa.salesAgent.handoffToHumanOutOfHours;
    await this.logReply(conversation, reply, { type: 'NONE' });
    await this.notifySellerOfHandoff(conversation);
    return { reply, uiBlocks: [], state: nextState };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — وقتی هر دو فیلد ست نشده، یعنی
  // فروشگاه محدودیتی اعلام نکرده و همیشه «در ساعت کاری» حساب می‌شود. مقایسه با ساعت تهران
  // (تک‌منطقه‌ی زمانی، نیازی به ذخیره‌ی timezone جدا نیست) روی دقیقه‌های روز، شامل بازه‌ی
  // شبانه که از نیمه‌شب رد می‌شود (مثلاً ۲۲:۰۰ تا ۰۲:۰۰)
  private isWithinWorkingHours(store: {
    workingHoursStart: string | null;
    workingHoursEnd: string | null;
  }): boolean {
    if (!store.workingHoursStart || !store.workingHoursEnd) return true;

    const toMinutes = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const start = toMinutes(store.workingHoursStart);
    const end = toMinutes(store.workingHoursEnd);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const now = hour * 60 + minute;

    return start <= end
      ? now >= start && now <= end
      : now >= start || now <= end;
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — اگر فروشنده تلگرامش را وصل کرده باشد، سؤال
  // مشتری + دکمه‌ی «پاسخ بده» مستقیم پوش می‌شود؛ اگر نه، بی‌صدا رد می‌شود (فروشنده فقط از
  // پنل «نیاز به توجه» می‌بیند، مثل قبل)
  private async notifySellerOfHandoff(
    conversation: ConversationWithStore,
  ): Promise<void> {
    const chatId = conversation.store.ownerTelegramChatId;
    if (!chatId) return;
    const lastCustomerMessage = await this.prisma.conversationEvent.findFirst({
      where: { conversationId: conversation.id, type: 'CUSTOMER_MESSAGE' },
      orderBy: { createdAt: 'desc' },
    });
    const customerText =
      (lastCustomerMessage?.payload as { text?: string } | undefined)?.text ??
      '—';
    await this.telegramApi.sendText(
      chatId,
      fa.telegram.handoffNotification(customerText),
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.handoffReplyButton,
              callback_data: `sr:${conversation.id}`,
            },
          ],
        ],
      },
    );
  }

  // docs/PRD-seller-credit-billing.md بخش ۳ — سهمیه‌ی رایگان تمام و اعتبار فروشگاه هم صفر/منفی؛
  // این مکالمه از قبل (لحظه‌ی ساخت، decideBillingMode) به همین حالت قفل شده — بدون هیچ فراخوان AI
  private billingBlocked(conversation: ConversationWithStore): boolean {
    return conversation.billingMode === 'BLOCKED';
  }

  // docs/PRD-buyer-abuse-rate-limit.md — باید همین ابتدای هر پیام/اکشن واقعی مشتری چک شود،
  // قبل از هر فراخوان AI (حتی قبل از چک billingBlocked، چون این ارزان‌تر و اولویت‌دارتر است).
  // null یعنی مسدود نبوده، ادامه بده؛ غیر-null یعنی همین نتیجه را مستقیم برگردان.
  private async checkAbuseGuard(
    conversation: ConversationWithStore,
  ): Promise<EngineResult | null> {
    const { blocked, justLocked } = await this.abuseGuard.checkAndRecord(
      conversation.customerId,
    );
    if (!blocked) return null;
    if (justLocked) {
      await this.logReply(conversation, fa.salesAgent.abuseLocked, {
        type: 'NONE',
      });
      return {
        reply: fa.salesAgent.abuseLocked,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }
    // از قبل قفل بوده — سکوت کامل، طبق تصمیم بخش ۵ سند (بدون لاگ AGENT_REPLY تازه)
    return { reply: '', uiBlocks: [], state: conversation.currentState };
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
    flag?: 'UNCLEAR' | 'NO_KB_MATCH',
    trace?: AiTraceData,
  ) {
    // برخلاف قبل، طول کوتاه/رسیدن به سقف باید از هم تفکیک شوند (نه فقط یک بولین) — بخش
    // voice.reason در AI_TRACE (docs/PRD-admin-ai-decision-trace-log.md بخش ۱) به همین نیاز دارد
    let wantsVoice = false;
    let voiceReason:
      'TOO_SHORT' | 'CONVERSATION_CAP' | 'VOICE_VARIANT_OFF' | undefined;
    if (text.length > VOICE_MIN_REPLY_CHARS) {
      // docs/PRD-sales-agent-voice.md بخش ۶.۱ — گروه OFF باید واقعاً هیچ وویسی نبیند، نه
      // فقط اینکه پخش نشود؛ پس قبل از reserveVoiceSlot چک می‌شود (سهمیه‌ی مکالمه هم دست‌نخورده می‌ماند)
      if (conversation.voiceVariant === 'OFF') {
        voiceReason = 'VOICE_VARIANT_OFF';
      } else {
        wantsVoice = await this.reserveVoiceSlot(conversation.id);
        if (!wantsVoice) voiceReason = 'CONVERSATION_CAP';
      }
    } else {
      voiceReason = 'TOO_SHORT';
    }

    const payload: Prisma.InputJsonObject = {
      text,
      uiBlock,
      ...(flag ? { flag } : {}),
      ...(wantsVoice ? { voicePending: true } : {}),
    };

    const event = await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AGENT_REPLY',
        payload,
      },
    });

    let traceEventId: string | undefined;
    if (trace) {
      const tracePayload: Prisma.InputJsonObject = {
        intent: trace.intent,
        handler: trace.handler,
        factsOrPrompt: trace.factsOrPrompt,
        model: trace.model,
        ...(trace.kbSource ? { kbSource: trace.kbSource } : {}),
        voice: wantsVoice
          ? { generated: true }
          : { generated: false, reason: voiceReason },
      };
      const traceEvent = await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AI_TRACE',
          payload: tracePayload,
        },
      });
      traceEventId = traceEvent.id;
    }

    if (wantsVoice) {
      await this.voiceQueue.add('generate', {
        eventId: event.id,
        conversationId: conversation.id,
        text: truncateForVoice(text),
        storeCategory: conversation.store.category,
        ...(traceEventId ? { traceEventId } : {}),
      });
    }
  }

  // افزایش اتمیک با شرط سقف — دو پاسخ هم‌زمان نمی‌توانند هردو از سقف رد شوند (طبق پلن،
  // updateMany شرطی همان الگوی atomic increment رایج در Postgres/Prisma)
  private async reserveVoiceSlot(conversationId: string): Promise<boolean> {
    const result = await this.prisma.salesConversation.updateMany({
      where: {
        id: conversationId,
        voiceGenerationCount: { lt: VOICE_MAX_PER_CONVERSATION },
      },
      data: { voiceGenerationCount: { increment: 1 } },
    });
    return result.count > 0;
  }
}
