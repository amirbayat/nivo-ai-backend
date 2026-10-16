import { createHash } from 'crypto';
import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, HttpException, HttpStatus } from '@nestjs/common';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { PricingService } from '../usage/pricing.service';
import { setCallSite } from '../../common/ai-cost-engine/ace-context';
import { getProductQualityGuide } from './product-quality-guides';
import { ruleReview } from './product-quality-rules';
import { clampProductSpecs, parseProductSpecs, type ProductSpecItem } from './product-specs.types';
import { setQualityReviewHandler } from './quality-review-scheduler';

const MODEL = 'openai/gpt-5.4-mini';
const MAX_DESCRIPTION_CHARS = 2000;

const applySchema = z.object({
  descriptionAddition: z.string().nullable(),
  specsAdditions: z.array(z.object({ label: z.string(), value: z.string() })).max(3),
});

// PQ-3 — ادغام امن: مدل فقط «افزوده» می‌دهد؛ متن قبلی و specs قبلی دست‌نخورده می‌مانند،
// تکراری اضافه نمی‌شود و سقف طول رعایت می‌شود
export function mergeQualityAnswer(
  description: string | null,
  specs: ProductSpecItem[],
  out: { descriptionAddition: string | null; specsAdditions: ProductSpecItem[] },
): { description: string; specs: ProductSpecItem[] } {
  const base = (description ?? '').trim();
  const add = out.descriptionAddition?.trim() ?? '';
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  let next = base;
  if (add && !norm(base).includes(norm(add))) next = base ? `${base}\n${add}` : add;
  next = next.slice(0, MAX_DESCRIPTION_CHARS);
  const have = new Set(specs.map((s) => norm(s.label)));
  const merged = [...specs];
  for (const a of out.specsAdditions) {
    if (!a.label.trim() || !a.value.trim() || have.has(norm(a.label))) continue;
    have.add(norm(a.label));
    merged.push({ label: a.label, value: a.value });
  }
  return { description: next, specs: clampProductSpecs(merged) ?? [] };
}
const DEBOUNCE_MS = 10_000;
const DAILY_CAP = 60;

const reviewSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(['weak', 'ok', 'good', 'great']),
  summary: z.string().nullable(),
  items: z.array(z.object({ key: z.string(), status: z.enum(['ok', 'missing', 'weak']), note: z.string().nullable() })),
  suggestions: z
    .array(z.object({ key: z.string(), title: z.string(), why: z.string(), askPrompt: z.string(), exampleText: z.string() }))
    .max(3),
  buyerQuestionsUnanswered: z.array(z.string()).max(3),
});
export type ProductQualityReview = z.infer<typeof reviewSchema>;

export type QualityReviewStatus = 'pending' | 'ready' | 'rules_only';

// ورودی‌هایی که روی hash اثر دارند (PRODUCT: name، description، specs، options، قیمت، تعداد عکس)
export function productInputHash(p: {
  name: string; description: string | null; specs: unknown; options: { name: string; values: string[] }[]; basePrice: number; imageCount: number;
}): string {
  return createHash('sha1').update(JSON.stringify([p.name, p.description ?? '', p.specs ?? null, p.options, p.basePrice, p.imageCount])).digest('hex');
}

export function shouldReview(p: { name: string; description: string | null; specs: unknown; options: unknown[] }): boolean {
  const hasBody = !!p.description?.trim() || (p.specs && Object.keys(p.specs as object).length > 0) || p.options.length > 0;
  return !!p.name?.trim() && !!hasBody;
}

@Injectable()
export class ProductQualityReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductQualityReviewService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly provider;
  private tableWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aiProvider: AiProviderService,
    private readonly pricing: PricingService,
  ) {
    this.provider = this.aiProvider.buildClient(undefined, { supportsStructuredOutputs: true });
  }

  onModuleInit(): void {
    setQualityReviewHandler((id) => this.schedule(id));
  }

  onModuleDestroy(): void {
    setQualityReviewHandler(null);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  // debounce هر محصول: ذخیره‌های پشت‌سرهم/autosave ده‌ها بررسی نمی‌سازند (جایگزین jobId=productId)
  schedule(productId: string): void {
    const prev = this.timers.get(productId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(productId);
      void this.run(productId, false).catch((err) => this.logger.warn(`quality review failed (${productId}): ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    t.unref?.();
    this.timers.set(productId, t);
  }

  private async loadProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        store: { select: { id: true, category: true, sellerId: true } },
        optionTypes: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
      },
    });
  }

  private async capReached(storeId: string): Promise<boolean> {
    try {
      const key = `pq:cap:${storeId}:${new Date().toISOString().slice(0, 10)}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 36 * 3600);
      return n > DAILY_CAP;
    } catch {
      return false; // fail-open
    }
  }

  // PQ-5 — سؤال‌های بی‌جواب مشتری (۳۰ روز اخیر) برای همین محصول؛ فقط رویداد faq_miss
  async unansweredQuestions(storeId: string, productId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.productEvent.findMany({
        where: { name: 'faq_miss', storeId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        select: { props: true },
        take: 500,
      });
      const counts = new Map<string, { text: string; n: number }>();
      for (const r of rows) {
        const p = (r.props ?? {}) as { productId?: string; question?: string };
        if (p.productId !== productId || !p.question) continue;
        const norm = p.question.replace(/[\s؟?!.،,]+/g, ' ').trim().toLowerCase();
        if (!norm) continue;
        const cur = counts.get(norm);
        if (cur) cur.n++;
        else counts.set(norm, { text: p.question.trim(), n: 1 });
      }
      return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((c) => c.text);
    } catch {
      return [];
    }
  }

  async run(productId: string, manual: boolean): Promise<'done' | 'skipped' | 'capped' | 'no_table'> {
    const product = await this.loadProduct(productId);
    if (!product) return 'skipped';
    const options = product.optionTypes.map((o) => ({ name: o.name, values: o.values.map((v) => v.value) }));
    if (!shouldReview({ name: product.name, description: product.description, specs: product.specs, options })) return 'skipped';
    const hash = productInputHash({
      name: product.name, description: product.description, specs: product.specs, options,
      basePrice: product.basePrice, imageCount: product.images.length,
    });
    let existing: { inputHash: string } | null = null;
    try {
      existing = await this.prisma.contentQualityReview.findUnique({
        where: { entityType_entityId: { entityType: 'PRODUCT', entityId: productId } },
        select: { inputHash: true },
      });
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    if (existing?.inputHash === hash && !manual) return 'skipped';
    if (await this.capReached(product.storeId)) return 'capped';

    const guide = getProductQualityGuide(product.store.category);
    const questions = await this.unansweredQuestions(product.storeId, productId);
    setCallSite('quality_review');
    const { object, usage } = await generateObject({
      model: this.provider(MODEL),
      schema: reviewSchema,
      system: SYSTEM_PROMPT,
      prompt: [
        `دسته: ${product.store.category ?? 'نامشخص'}`,
        `نام: ${product.name}`,
        `قیمت: ${product.basePrice} تومان`,
        `تعداد عکس: ${product.images.length}`,
        `توضیح: ${product.description ?? '(خالی)'}`,
        `مشخصات (specs): ${JSON.stringify(product.specs ?? {})}`,
        `گزینه‌ها: ${JSON.stringify(options)}`,
        `آیتم‌های راهنمای این دسته:\n${guide.map((g) => `- ${g.key}: ${g.label}`).join('\n')}`,
        questions.length ? `سؤال‌های واقعی بی‌جواب مشتری‌ها:\n${questions.map((q) => `- ${q}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    });

    // فقط کلیدهای راهنما معتبرند؛ مدل نباید آیتم اختراع کند
    const valid = new Set(guide.map((g) => g.key));
    const review: ProductQualityReview = {
      ...object,
      items: object.items.filter((i) => valid.has(i.key)),
      suggestions: object.suggestions.filter((s) => valid.has(s.key)).slice(0, 3),
      buyerQuestionsUnanswered: questions.length ? questions : object.buyerQuestionsUnanswered.slice(0, 3),
    };
    try {
      await this.prisma.contentQualityReview.upsert({
        where: { entityType_entityId: { entityType: 'PRODUCT', entityId: productId } },
        create: { entityType: 'PRODUCT', entityId: productId, storeId: product.storeId, review: review as never, inputHash: hash },
        update: { review: review as never, inputHash: hash, reviewedAt: new Date() },
      });
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    // رایگان برای فروشنده؛ فقط ثبت هزینه برای آمار (مثل ai-fill)
    try {
      const { costToman } = await this.pricing.calcCost(usage.inputTokens ?? 0, usage.outputTokens ?? 0, MODEL);
      await this.prisma.creditUsageEvent.create({
        data: { storeId: product.storeId, model: MODEL, kind: 'PRODUCT_ENRICHMENT', costToman, isFreeQuota: true },
      });
    } catch (err) {
      this.logger.warn(`quality review usage log failed: ${(err as Error).message}`);
    }
    return 'done';
  }

  private warnTable(err: unknown): void {
    if (this.tableWarned) return;
    this.tableWarned = true;
    this.logger.warn(`content_quality_review unavailable (SQL اجرا شده؟): ${(err as Error).message}`);
  }

  private async getOwned(sellerId: string, storeId: string, productId: string) {
    const product = await this.loadProduct(productId);
    if (!product || product.storeId !== storeId || product.store.sellerId !== sellerId) throw new NotFoundException();
    return product;
  }

  // GET — همیشه قاعده‌ای را هم برمی‌گرداند؛ جدول نبود → rules_only بدون خطا
  async getReview(sellerId: string, storeId: string, productId: string) {
    const product = await this.getOwned(sellerId, storeId, productId);
    const options = product.optionTypes.map((o) => ({ name: o.name, values: o.values.map((v) => v.value) }));
    const rules = ruleReview({
      name: product.name, description: product.description, specs: product.specs, imageCount: product.images.length,
      category: product.store.category, optionTypes: options,
    });
    const hash = productInputHash({
      name: product.name, description: product.description, specs: product.specs, options,
      basePrice: product.basePrice, imageCount: product.images.length,
    });
    try {
      const row = await this.prisma.contentQualityReview.findUnique({
        where: { entityType_entityId: { entityType: 'PRODUCT', entityId: productId } },
      });
      if (!row) {
        const eligible = shouldReview({ name: product.name, description: product.description, specs: product.specs, options });
        return { status: (eligible ? 'pending' : 'rules_only') as QualityReviewStatus, review: null, rules };
      }
      return {
        status: (row.inputHash === hash ? 'ready' : 'pending') as QualityReviewStatus,
        review: row.review as ProductQualityReview,
        rules,
      };
    } catch (err) {
      this.warnTable(err);
      return { status: 'rules_only' as QualityReviewStatus, review: null, rules };
    }
  }

  // PQ-3 — «جواب بده تا اضافه‌اش کنم»: فقط پیش‌نمایش؛ ذخیره با PATCH معمولی بعد از تأیید فروشنده
  async apply(sellerId: string, storeId: string, productId: string, key: string, answer: string) {
    const product = await this.getOwned(sellerId, storeId, productId);
    const guide = getProductQualityGuide(product.store.category);
    const item = guide.find((g) => g.key === key);
    if (!item) throw new NotFoundException();
    const specs = parseProductSpecs(product.specs);
    setCallSite('quality_apply');
    const { object } = await generateObject({
      model: this.provider(MODEL),
      schema: applySchema,
      system: `تو پاسخ فروشنده را در توضیح یک محصول ادغام می‌کنی.
- فقط اطلاعاتِ همین آیتم («${item.label}») را اضافه کن؛ چیز دیگری اضافه یا بازنویسی نکن.
- descriptionAddition: یک یا دو جمله‌ی فارسی کوتاه با همان لحن توضیح فعلی؛ اگر آن اطلاعات از قبل در توضیح هست null بده.
- specsAdditions: فقط اگر پاسخ یک مشخصه‌ی کوتاه (مثل «جنس: نخ پنبه») دارد، حداکثر ۳ مورد؛ برچسبی که از قبل هست تکرار نشود.
- هرگز چیزی که فروشنده نگفته اختراع نکن.`,
      prompt: `نام محصول: ${product.name}\nتوضیح فعلی: ${product.description ?? '(خالی)'}\nمشخصات فعلی: ${JSON.stringify(specs)}\nپاسخ فروشنده: ${answer}`,
    });
    return mergeQualityAnswer(product.description, specs, object);
  }

  async refresh(sellerId: string, storeId: string, productId: string) {
    await this.getOwned(sellerId, storeId, productId);
    const result = await this.run(productId, true);
    if (result === 'capped') throw new HttpException('quality review daily cap', HttpStatus.TOO_MANY_REQUESTS);
    return this.getReview(sellerId, storeId, productId);
  }
}

const SYSTEM_PROMPT = `تو یک مشاور فروش آنلاین هستی و توضیحات یک محصول را برای «آمادگی فروش» بررسی می‌کنی.
قواعد:
- فقط بر اساس متن و فیلدهای داده‌شده قضاوت کن؛ چیزی را حدس نزن.
- چیزی که در specs یا گزینه‌ها (سایز/رنگ و …) هست «missing» نیست.
- برای هر آیتم راهنما یک وضعیت بده: ok (پوشش داده‌شده)، weak (هست ولی کلی/ناقص)، missing (اصلاً نیست). key را عیناً از فهرست راهنما بنویس.
- suggestions حداکثر ۳ مورد، مرتب بر اساس اثر روی فروش؛ برای هر کدام title کوتاه، why (یک جمله که چرا فروش را بالا می‌برد)، askPrompt (سؤالی که از فروشنده پرسیده می‌شود) و exampleText.
- exampleText یک نمونه‌ی کوتاه و واقعی برای همین محصول است، با جای خالی برای چیزی که نمی‌دانی (مثلاً «جنس: [مثلاً نخ پنبه ۱۰۰٪]»). هرگز مشخصه‌ای اختراع نکن.
- summary یک جمله‌ی صمیمی و مثبت (اول چیزی که خوب است).
- score بین ۰ تا ۱۰۰؛ level: زیر ۴۰ weak، تا ۶۴ ok، تا ۸۴ good، بالاتر great.
- اگر «سؤال‌های واقعی بی‌جواب مشتری‌ها» داده شده، آن‌ها را در buyerQuestionsUnanswered بیاور (حداکثر ۳).
- لحن فارسی صمیمی و محترمانه.`;
