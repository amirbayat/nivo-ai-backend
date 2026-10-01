import { Injectable, NotFoundException } from '@nestjs/common';
import { generateObject, generateText } from 'ai';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { StoreKbService } from '../store/store-kb.service';
import { fa } from '../../i18n/fa';
import { resolveModel } from './model-variants';
import { toneForCategory } from './tone-by-category';
import { GOLDEN_QUESTIONS } from './qa-golden-questions';
import { INTENT_GOLDEN_CASES } from './intent-golden-cases';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from './intent-classification.schema';

export interface GoldenQuestionResult {
  id: string;
  category: string;
  question: string;
  answer?: string;
  error?: string;
  latencyMs: number;
}

// docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵.۴
export interface IntentGoldenResult {
  id: string;
  message: string;
  expectedIntent: string;
  actualIntent?: string;
  intentConfidence?: string;
  expectedBuyerNeeds?: string[];
  actualBuyerNeeds?: string[];
  unmatchedBuyerNeed?: string;
  passed: boolean;
  error?: string;
  latencyMs: number;
}

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۵ — عمداً کاملاً مستقل از
// ConversationEngineService: هیچ ConversationEvent/CreditUsageEvent‌ای اینجا ساخته نمی‌شود
// (این یک اجرای آزمایشی/خشک برای بازبینی ادمین است، نه یک مکالمه‌ی واقعی) — پس هزینه‌ای هم
// از اعتبار فروشگاه کم نمی‌کند و در آمار A/B واقعی (AbModelMetric) دیده نمی‌شود
@Injectable()
export class SalesAgentQaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly storeKb: StoreKbService,
  ) {}

  async listStores() {
    return this.prisma.store.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async runGoldenSet(
    storeId: string,
    variantKey: string,
  ): Promise<GoldenQuestionResult[]> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException(fa.store.notFound);

    const products = await this.prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { name: true, basePrice: true, stock: true, description: true },
    });

    const storeProfileFacts = [
      store.shippingInfo && `ارسال/هزینه‌ی ارسال: ${store.shippingInfo}`,
      store.returnPolicy && `شرایط مرجوعی/گارانتی: ${store.returnPolicy}`,
      store.brandIntro && `معرفی فروشگاه: ${store.brandIntro}`,
    ]
      .filter(Boolean)
      .join('\n');

    const productFacts = products.length
      ? `محصولات فروشگاه: ${products
          .map(
            (p) =>
              `${p.name} (${p.basePrice} تومان)${p.stock === 0 ? ' — فعلاً ناموجود' : ''}${p.description ? ` — توضیحات: ${p.description}` : ''}`,
          )
          .join('، ')}`
      : '';

    const model = resolveModel(variantKey);
    const tone = toneForCategory(store.category);

    const results: GoldenQuestionResult[] = [];
    for (const golden of GOLDEN_QUESTIONS) {
      const started = Date.now();
      try {
        const kbMatch = await this.storeKb.retrieveRelevant(
          storeId,
          golden.question,
        );
        const facts = [
          kbMatch &&
            `سؤال مشابه قبلی مشتری: ${kbMatch.question}\nجواب واقعی: ${kbMatch.answer}`,
          storeProfileFacts,
          productFacts,
        ]
          .filter(Boolean)
          .join('\n');

        const { text } = await generateText({
          model: this.aiProvider.buildClient()(model),
          system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. اگر واقعیت‌ها کافی نیست،
صادقانه بگو نمی‌دانی. هرگز تعداد دقیق موجودی انبار را اعلام نکن. لحن نوشتار باید ${tone} باشد.`,
          prompt: `واقعیت‌های فروشگاه:\n${facts || 'چیز خاصی ثبت نشده'}\n\nسؤال مشتری: ${golden.question}`,
          temperature: 0.3,
        });
        results.push({
          id: golden.id,
          category: golden.category,
          question: golden.question,
          answer: text.trim(),
          latencyMs: Date.now() - started,
        });
      } catch (err) {
        results.push({
          id: golden.id,
          category: golden.category,
          question: golden.question,
          error: err instanceof Error ? err.message : 'خطای نامشخص',
          latencyMs: Date.now() - started,
        });
      }
    }
    return results;
  }

  // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵.۴ — همان schema/prompt واقعی
  // callParseIntent (intent-classification.schema.ts)، بدون هیچ وابستگی به یک فروشگاه/محصول
  // واقعی (بر خلاف runGoldenSet بالا که caption تولید می‌کند) — چون طبقه‌بندی intent اصلاً به
  // محصولات/پروفایل فروشگاه وابسته نیست، فقط به متن پیام و وضعیت مکالمه
  async runIntentGoldenSet(variantKey: string): Promise<IntentGoldenResult[]> {
    const model = resolveModel(variantKey);
    const results: IntentGoldenResult[] = [];
    for (const goldenCase of INTENT_GOLDEN_CASES) {
      const started = Date.now();
      try {
        const { object } = await generateObject({
          model: this.aiProvider.buildClient(undefined, {
            supportsStructuredOutputs: true,
          })(model),
          schema: intentClassificationSchema,
          system: buildIntentClassificationPrompt(
            goldenCase.state ?? 'BROWSING',
          ),
          prompt: goldenCase.message,
        });
        const actualBuyerNeeds = object.buyerNeeds ?? [];
        const buyerNeedsOk =
          !goldenCase.expectedBuyerNeeds?.length ||
          goldenCase.expectedBuyerNeeds.every((t) =>
            actualBuyerNeeds.includes(t),
          );
        results.push({
          id: goldenCase.id,
          message: goldenCase.message,
          expectedIntent: goldenCase.expectedIntent,
          actualIntent: object.intent,
          intentConfidence: object.intentConfidence,
          expectedBuyerNeeds: goldenCase.expectedBuyerNeeds,
          actualBuyerNeeds,
          unmatchedBuyerNeed: object.unmatchedBuyerNeed ?? undefined,
          passed: object.intent === goldenCase.expectedIntent && buyerNeedsOk,
          latencyMs: Date.now() - started,
        });
      } catch (err) {
        results.push({
          id: goldenCase.id,
          message: goldenCase.message,
          expectedIntent: goldenCase.expectedIntent,
          passed: false,
          error: err instanceof Error ? err.message : 'خطای نامشخص',
          latencyMs: Date.now() - started,
        });
      }
    }
    return results;
  }
}
