import { createHash } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { PricingService } from '../usage/pricing.service';
import { setCallSite } from '../../common/ai-cost-engine/ace-context';
import { setStoreQualityReviewHandler } from './quality-review-scheduler';
import { getStoreQualityGuide } from './store-quality-guides';
import { ruleStoreReview, type StoreQualityInput } from './store-quality-rules';
import { maskPaymentSecrets } from '../../common/utils/payment-secret-mask.util';
import { assertQualityApplyCap } from './quality-apply-cap';

const MODEL = 'openai/gpt-5.4-mini';
const DEBOUNCE_MS = 10_000;
const DAILY_CAP = 20;
const TEXT_FIELDS = ['brandIntro', 'returnPolicy', 'shippingInfo'] as const;
export type StoreTextField = (typeof TEXT_FIELDS)[number];

const reviewSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(['weak', 'ok', 'good', 'great']),
  summary: z.string().nullable(),
  items: z.array(z.object({ key: z.string(), status: z.enum(['ok', 'missing', 'weak']), note: z.string().nullable() })),
  suggestions: z
    .array(z.object({ key: z.string(), title: z.string(), why: z.string(), askPrompt: z.string(), exampleText: z.string(), fromNotes: z.boolean() }))
    .max(3),
  buyerQuestionsUnanswered: z.array(z.string()).max(3),
  trustLines: z.array(z.string()).max(3),
});
export type StoreQualityReview = z.infer<typeof reviewSchema> & { suggestions: (z.infer<typeof reviewSchema>['suggestions'][number] & { target?: string })[] };

// ارزش‌های روزمره‌ی hash: همه‌ی ورودی‌ها به‌جز سؤال‌های بی‌جواب (تا با هر miss دوباره ساخته نشود؛ SQ-5 روزانه refresh می‌کند)
export function storeInputHash(input: StoreQualityInput & { kbQuestions: string[]; paymentKinds: string[]; shippingSummary: string }): string {
  const { kbQuestions, paymentKinds, shippingSummary, ...rest } = input;
  return createHash('sha1').update(JSON.stringify([rest, kbQuestions, paymentKinds, shippingSummary])).digest('hex');
}

@Injectable()
export class StoreQualityReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreQualityReviewService.name);
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
    setStoreQualityReviewHandler((id) => this.schedule(id));
  }

  onModuleDestroy(): void {
    setStoreQualityReviewHandler(null);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  // jobId=store:{storeId}، delay ۱۰ ثانیه
  schedule(storeId: string): void {
    const prev = this.timers.get(storeId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(storeId);
      void this.run(storeId, false).catch((err) => this.logger.warn(`store quality review failed (${storeId}): ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    t.unref?.();
    this.timers.set(storeId, t);
  }

  private async loadInput(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        bankCards: { where: { isActive: true }, select: { id: true } },
        shippingRules: { select: { provinces: true, cost: true, enabled: true } },
      },
    });
    if (!store) return null;
    const kb = await this.prisma.storeKbEntry.findMany({ where: { storeId, isActive: true }, select: { question: true }, take: 100 });
    const paymentKinds = [store.bankCards.length > 0 || (store.bankCardNumber && store.bankOwnerName) ? 'CARD_TO_CARD' : null, store.snapppayPaymentLink ? 'SNAPPPAY' : null].filter(Boolean) as string[];
    const base: StoreQualityInput = {
      category: store.category, requiresShipping: store.requiresShipping, brandIntro: store.brandIntro, returnPolicy: store.returnPolicy,
      shippingInfo: store.shippingInfo, ownerNotes: store.ownerNotes ? store.ownerNotes.slice(-2000) : null,
      shippingDaysMin: store.shippingDaysMin, shippingDaysMax: store.shippingDaysMax, returnPolicyMode: store.returnPolicyMode,
      workingHoursStart: store.workingHoursStart, workingHoursEnd: store.workingHoursEnd, logoImageKey: store.logoImageKey,
      instagramUrl: store.instagramUrl, shippingRulesCount: store.shippingRules.filter((r) => r.enabled).length,
      hasPaymentMethod: paymentKinds.length > 0, kbCount: kb.length,
    };
    const shippingSummary = store.shippingRules.filter((r) => r.enabled).map((r) => `${r.provinces.length ? r.provinces.join('، ') : 'همه'}: ${r.cost}`).join(' | ');
    return { store, base, kbQuestions: kb.map((k) => k.question), paymentKinds, shippingSummary };
  }

  private async capReached(storeId: string): Promise<boolean> {
    try {
      const key = `sq:cap:${storeId}:${new Date().toISOString().slice(0, 10)}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 36 * 3600);
      return n > DAILY_CAP;
    } catch {
      return false;
    }
  }

  // SQ-5 — سؤال‌های بی‌جوابِ سطح فروشگاه: faq_miss بدون productId + topicهای attentionSuggestions (field غیر از other)
  async unansweredQuestions(storeId: string, attention: unknown): Promise<{ text: string; field: string | null }[]> {
    const merged = new Map<string, { text: string; n: number; field: string | null }>();
    const norm = (q: string) => q.replace(/[\s؟?!.،,]+/g, ' ').trim().toLowerCase();
    try {
      const rows = await this.prisma.productEvent.findMany({
        where: { name: 'faq_miss', storeId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        select: { props: true },
        take: 500,
      });
      for (const r of rows) {
        const p = (r.props ?? {}) as { productId?: string | null; question?: string };
        if (p.productId || !p.question) continue;
        const k = norm(p.question);
        if (!k) continue;
        const cur = merged.get(k);
        if (cur) cur.n++;
        else merged.set(k, { text: p.question.trim(), n: 1, field: null });
      }
    } catch {
      /* بدون رویداد */
    }
    const topics = Array.isArray((attention as { topics?: unknown } | null)?.topics) ? ((attention as { topics: { summary?: string; field?: string; occurrences?: number }[] }).topics) : [];
    for (const t of topics) {
      if (!t.summary || !t.field || t.field === 'other') continue;
      const k = norm(t.summary);
      const cur = merged.get(k);
      if (cur) { cur.n += t.occurrences ?? 1; cur.field = t.field; }
      else merged.set(k, { text: t.summary, n: t.occurrences ?? 1, field: t.field });
    }
    return [...merged.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((m) => ({ text: m.text, field: m.field }));
  }

  async run(storeId: string, manual: boolean): Promise<'done' | 'skipped' | 'capped' | 'no_table'> {
    const loaded = await this.loadInput(storeId);
    if (!loaded) return 'skipped';
    const { store, base, kbQuestions, paymentKinds, shippingSummary } = loaded;
    const hash = storeInputHash({ ...base, kbQuestions, paymentKinds, shippingSummary });
    let existing: { inputHash: string; reviewedAt: Date } | null = null;
    try {
      existing = await this.prisma.contentQualityReview.findUnique({
        where: { entityType_entityId: { entityType: 'STORE', entityId: storeId } },
        select: { inputHash: true, reviewedAt: true },
      });
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    // SQ-5: سؤال‌های جدید روزی یک‌بار refresh می‌کنند
    const staleDay = !existing || Date.now() - existing.reviewedAt.getTime() > 24 * 3600 * 1000;
    if (existing?.inputHash === hash && !manual && !staleDay) return 'skipped';
    if (await this.capReached(storeId)) return 'capped';

    const guide = getStoreQualityGuide(store.category, store.requiresShipping);
    const questions = await this.unansweredQuestions(storeId, store.attentionSuggestions);
    setCallSite('store_quality_review');
    const { object, usage } = await generateObject({
      model: this.provider(MODEL),
      schema: reviewSchema,
      system: STORE_SYSTEM_PROMPT,
      // REV-3 — متن‌های آزاد (یادداشت، معرفی، KB) ممکن است شماره کارت/شبا داشته باشند
      prompt: maskPaymentSecrets([
        `دسته: ${store.category ?? 'نامشخص'}`,
        `فروشگاه ارسال دارد: ${store.requiresShipping ? 'بله' : 'خیر'}`,
        `معرفی برند: ${store.brandIntro ?? '(خالی)'}`,
        `شرایط مرجوعی (متن): ${store.returnPolicy ?? '(خالی)'}`,
        `توضیح ارسال: ${store.shippingInfo ?? '(خالی)'}`,
        `قوانین ارسال: ${shippingSummary || '(ندارد)'}`,
        `بازه‌ی ارسال (روز): ${store.shippingDaysMin ?? '—'} تا ${store.shippingDaysMax ?? '—'}`,
        `مهلت مرجوعی (روز): ${store.returnWindowDays}؛ هزینه‌ی برگشت با: ${store.returnShippingPaidBy === 'SELLER' ? 'فروشنده' : 'خریدار'}`,
        `ساعت کاری: ${store.workingHoursStart && store.workingHoursEnd ? `${store.workingHoursStart} تا ${store.workingHoursEnd}` : '(ندارد)'}`,
        `روش‌های پرداخت (فقط نوع): ${paymentKinds.join('، ') || '(ندارد)'}`,
        `سؤال‌های باکس دانش: ${kbQuestions.slice(0, 40).join(' | ') || '(ندارد)'}`,
        `یادداشت‌های فروشنده (ownerNotes): ${base.ownerNotes ?? '(ندارد)'}`,
        `آیتم‌های راهنمای این دسته:\n${guide.map((g) => `- ${g.key} (${g.target}): ${g.label}`).join('\n')}`,
        questions.length ? `سؤال‌های واقعی بی‌جواب مشتری‌ها:\n${questions.map((q) => `- ${q.text}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')),
    });

    const byKey = new Map(guide.map((g) => [g.key, g]));
    const review: StoreQualityReview = {
      ...object,
      items: object.items.filter((i) => byKey.has(i.key)),
      suggestions: object.suggestions.filter((s) => byKey.has(s.key)).slice(0, 3).map((s) => ({ ...s, target: byKey.get(s.key)!.target })),
      buyerQuestionsUnanswered: questions.length ? questions.map((q) => q.text) : object.buyerQuestionsUnanswered.slice(0, 3),
      // trustLines بدون عدد قیمت: خطی که تومان/قیمت دارد حذف می‌شود
      trustLines: object.trustLines.filter((l) => !/(تومان|تومن|هزار|قیمت|تخفیف)/.test(l)).slice(0, 3),
    };
    try {
      await this.prisma.contentQualityReview.upsert({
        where: { entityType_entityId: { entityType: 'STORE', entityId: storeId } },
        create: { entityType: 'STORE', entityId: storeId, storeId, review: review as never, inputHash: hash },
        update: { review: review as never, inputHash: hash, reviewedAt: new Date() },
      });
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    try {
      const { costToman } = await this.pricing.calcCost(usage.inputTokens ?? 0, usage.outputTokens ?? 0, MODEL);
      await this.prisma.creditUsageEvent.create({ data: { storeId, model: MODEL, kind: 'PRODUCT_ENRICHMENT', costToman, isFreeQuota: true } });
    } catch (err) {
      this.logger.warn(`store quality usage log failed: ${(err as Error).message}`);
    }
    return 'done';
  }

  private warnTable(err: unknown): void {
    if (this.tableWarned) return;
    this.tableWarned = true;
    this.logger.warn(`content_quality_review unavailable (SQL اجرا شده؟): ${(err as Error).message}`);
  }

  private async getOwnedStoreId(sellerId: string, storeId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { sellerId: true } });
    if (!store || store.sellerId !== sellerId) throw new NotFoundException();
  }

  async getReview(sellerId: string, storeId: string) {
    await this.getOwnedStoreId(sellerId, storeId);
    const loaded = await this.loadInput(storeId);
    if (!loaded) throw new NotFoundException();
    const rules = ruleStoreReview(loaded.base);
    const hash = storeInputHash({ ...loaded.base, kbQuestions: loaded.kbQuestions, paymentKinds: loaded.paymentKinds, shippingSummary: loaded.shippingSummary });
    try {
      const row = await this.prisma.contentQualityReview.findUnique({ where: { entityType_entityId: { entityType: 'STORE', entityId: storeId } } });
      if (!row) return { status: 'pending' as const, review: null, rules };
      return { status: row.inputHash === hash ? ('ready' as const) : ('pending' as const), review: row.review as StoreQualityReview, rules };
    } catch (err) {
      this.warnTable(err);
      return { status: 'rules_only' as const, review: null, rules };
    }
  }

  async refresh(sellerId: string, storeId: string) {
    await this.getOwnedStoreId(sellerId, storeId);
    const r = await this.run(storeId, true);
    if (r === 'capped') throw new HttpException('store quality review daily cap', HttpStatus.TOO_MANY_REQUESTS);
    return this.getReview(sellerId, storeId);
  }

  // SQ-3 — فقط فیلدهای متنی؛ پیش‌نمایش { field, newText } (+ پیشنهاد مهلت/هزینه‌ی مرجوعی اگر با فعلی فرق دارد)
  async apply(sellerId: string, storeId: string, key: string, answer: string) {
    await this.getOwnedStoreId(sellerId, storeId);
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException();
    const guide = getStoreQualityGuide(store.category, store.requiresShipping);
    const item = guide.find((g) => g.key === key);
    if (!item || !(TEXT_FIELDS as readonly string[]).includes(item.target)) throw new NotFoundException();
    const field = item.target as StoreTextField;
    const max = field === 'brandIntro' ? (store.leadCaptureOnly ? 2000 : 1500) : 1000;
    const current = store[field] ?? '';
    await assertQualityApplyCap(this.redis, storeId);
    setCallSite('store_quality_apply');
    const { object } = await generateObject({
      model: this.provider(MODEL),
      schema: z.object({
        newText: z.string(),
        returnWindowDays: z.number().int().min(0).max(365).nullable(),
        returnShippingPaidBy: z.enum(['BUYER', 'SELLER']).nullable(),
      }),
      system: `تو جواب فروشنده را در متن «${field}» فروشگاه ادغام می‌کنی.
- فقط اطلاعات «${item.label}» را اضافه کن، متن قبلی را دست‌نخورده نگه دار، لحن را حفظ کن و چیزی را تکرار نکن.
- طول کل متن حداکثر ${max} کاراکتر باشد (فشرده بنویس).
- چیزی که فروشنده نگفته اختراع نکن.
- returnWindowDays و returnShippingPaidBy فقط اگر جواب فروشنده صریحاً مهلت یا هزینه‌ی برگشت را گفته؛ وگرنه null.`,
      prompt: maskPaymentSecrets(`متن فعلی: ${current || '(خالی)'}\nجواب فروشنده: ${answer}`),
    });
    const newText = object.newText.trim().slice(0, max);
    return {
      field,
      newText,
      suggestedReturnWindowDays: field === 'returnPolicy' && object.returnWindowDays != null && object.returnWindowDays !== store.returnWindowDays ? object.returnWindowDays : null,
      suggestedReturnShippingPaidBy: field === 'returnPolicy' && object.returnShippingPaidBy && object.returnShippingPaidBy !== store.returnShippingPaidBy ? object.returnShippingPaidBy : null,
    };
  }
}

const STORE_SYSTEM_PROMPT = `تو یک مشاور فروش آنلاین هستی و «پروفایل فروشگاه» را برای اینکه بات بتواند به سؤال‌های مشتری جواب بدهد بررسی می‌کنی.
قواعد:
- فقط بر اساس داده‌ی داده‌شده قضاوت کن. چیزی که در فیلد ساخت‌یافته هست (مثلاً مهلت مرجوعی، بازه‌ی ارسال) در متن «missing» نیست.
- برای هر آیتم راهنما یک وضعیت بده: ok، weak (کلی/ناقص)، missing. key را عیناً از فهرست راهنما بنویس.
- suggestions حداکثر ۳، مرتب بر اثر روی فروش؛ برای هر کدام key، title، why (یک جمله)، askPrompt، exampleText.
- اگر جواب یک کمبود در «یادداشت‌های فروشنده» هست، exampleText همان واقعیت از یادداشت باشد و fromNotes=true (حرف خود فروشنده است). وگرنه جای خالی بگذار («مهلت مرجوعی: [مثلاً ۷ روز]») و fromNotes=false. هرگز مشخصه‌ای اختراع نکن.
- trustLines: ۲ تا ۳ جمله‌ی اعتمادساز فقط از متن موجود، بدون هیچ عدد قیمت و بدون ادعای بی‌منبع.
- summary یک جمله‌ی صمیمی و مثبت. score ۰..۱۰۰؛ level: زیر ۴۰ weak، تا ۶۴ ok، تا ۸۴ good، بالاتر great.
- سؤال‌های بی‌جواب مشتری (اگر داده شد) را در buyerQuestionsUnanswered بیاور (حداکثر ۳).
- لحن فارسی صمیمی.`;
