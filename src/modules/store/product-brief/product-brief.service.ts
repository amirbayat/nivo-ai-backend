import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { generateObject } from 'ai';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AiProviderService } from '../../../common/services/ai-provider.service';
import { PricingService } from '../../usage/pricing.service';
import { setCallSite } from '../../../common/ai-cost-engine/ace-context';
import { maskPaymentSecrets } from '../../../common/utils/payment-secret-mask.util';
import { PERCEPTION_MODEL } from '../../sales-agent/model-variants';
import { parseProductSpecs } from '../product-specs.types';
import { setProductBriefHandler } from '../quality-review-scheduler';
import { briefInputHash } from './brief-hash';
import { briefLlmSchema } from './brief.schema';
import { splitSections } from './section-splitter';
import { BRIEF_TOPICS } from './topics';
import { validateBrief } from './validate';

export { briefInputHash };
const DEBOUNCE_MS = 10_000;
const DAILY_CAP_PER_STORE = 300;
const MIN_DESCRIPTION_CHARS = 120;

const SYSTEM = `تو یک «برچسب‌زن و استخراج‌کننده» برای توضیح محصول فروشگاه هستی. هیچ جمله‌ای را بازنویسی نمی‌کنی.
متن توضیح به بخش‌های [s1] [s2] … شکسته شده. خروجی JSON طبق schema:
- sectionTopics: فقط برای بخش‌هایی که عنوان واضح ندارند، ۱ تا ۳ موضوع از این فهرست: ${BRIEF_TOPICS.join('، ')}.
- facts: حداکثر ۱۲ واقعیت کوتاه {k, v (≤۶۰ کاراکتر، عین عبارت متن)، sure, src}. sure=false وقتی فروشنده خودش تردید گذاشته («پیشنهادی»، «باید تأیید شود»، «حدود»، «بسته به»، «احتمالاً»). قیمت و موجودی را جزو facts نیاور.
- caveats: جمله‌های قید/هشدار فروشنده، «عین متن» همراه src.
- sellerRules: دستورهای فروشنده به دستیار فروش، «عین متن» همراه src. قیمت را در دستور نیاور.
- pitch: benefits (۳ تا ۵ مزیت واقعی، هر کدام ≤۱۲۰ کاراکتر، بدون عدد و بدون ادعای بی‌منبع)، benefitSources (برای هر benefit یکی از: description، specs.<برچسب>، optionTypes)، valueLines (۲ جمله توجیه ارزش بدون عدد)، followUps (۲ تا ۳ سؤال بعدی مرتبط با دسته)، openers (۲ تا ۳ شروع کوتاه). لحن صمیمی فروشنده‌ی ایرانی. هرگز «بهترین/بی‌نظیر/فقط امروز/ارزان» ننویس.
- textPriceStock: هر قیمت یا موجودی که «در متن» نوشته شده، عین عبارت (فقط برای مقایسه).
اگر چیزی در متن نیست، آرایه را خالی بگذار؛ هرگز اختراع نکن.`;

@Injectable()
export class ProductBriefService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductBriefService.name);
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
    setProductBriefHandler((id) => this.schedule(id));
  }

  onModuleDestroy(): void {
    setProductBriefHandler(null);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  schedule(productId: string): void {
    const prev = this.timers.get(productId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(productId);
      void this.build(productId, false).catch((err) => this.logger.warn(`product brief failed (${productId}): ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    t.unref?.();
    this.timers.set(productId, t);
  }

  private async capReached(storeId: string): Promise<boolean> {
    try {
      const key = `ace:brief:cap:${storeId}:${new Date().toISOString().slice(0, 10)}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 36 * 3600);
      return n > DAILY_CAP_PER_STORE;
    } catch {
      return false; // fail-open
    }
  }

  async build(productId: string, force: boolean): Promise<'done' | 'skipped' | 'capped' | 'failed' | 'no_table'> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        store: { select: { category: true } },
        optionTypes: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!product) return 'skipped';
    const description = product.description ?? '';
    if (description.trim().length < MIN_DESCRIPTION_CHARS) return 'skipped'; // صرفه‌ای ندارد (بند ۱۶.۵)
    const options = product.optionTypes.map((o) => ({ name: o.name, values: o.values.map((v) => v.value) }));
    const hash = briefInputHash({ name: product.name, description, specs: product.specs, options });

    try {
      const existing = await this.prisma.productBrief.findUnique({ where: { productId }, select: { descHash: true } });
      if (existing?.descHash === hash && !force) return 'skipped';
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    if (await this.capReached(product.storeId)) return 'capped';

    const { text, sections } = splitSections(description);
    const specs = parseProductSpecs(product.specs);
    const prompt = maskPaymentSecrets(
      [
        `دسته: ${product.store.category ?? 'نامشخص'}`,
        `نام: ${product.name}`,
        `توضیح (با برچسب بخش):\n${sections.map((s) => `[${s.id}] ${text.slice(s.start, s.end)}`).join('\n')}`,
        `مشخصات (specs): ${JSON.stringify(specs)}`,
        `گزینه‌ها: ${JSON.stringify(options)}`,
      ].join('\n'),
    );

    let result: ReturnType<typeof validateBrief> | null = null;
    for (let attempt = 0; attempt < 2 && !result?.ok; attempt++) {
      try {
        setCallSite('product_brief');
        const { object, usage } = await generateObject({
          model: this.provider(PERCEPTION_MODEL),
          schema: briefLlmSchema,
          system: SYSTEM,
          prompt,
          temperature: 0,
        });
        result = validateBrief(object, { text, sections, specs, optionTypes: options });
        await this.logUsage(product.storeId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      } catch (err) {
        this.logger.warn(`product brief LLM call failed (${productId}, try ${attempt + 1}): ${(err as Error).message}`);
      }
    }

    const sectionsJson = sections.map((s) => ({ ...s, topics: result?.topics[s.id] ?? ['OTHER'] }));
    const ok = !!result?.ok;
    try {
      await this.prisma.productBrief.upsert({
        where: { productId },
        create: {
          productId, storeId: product.storeId, descHash: hash,
          sections: sectionsJson as never, brief: (ok ? result!.brief : {}) as never, status: ok ? 'ok' : 'failed',
        },
        update: {
          storeId: product.storeId, descHash: hash,
          sections: sectionsJson as never, brief: (ok ? result!.brief : {}) as never, status: ok ? 'ok' : 'failed', builtAt: new Date(),
        },
      });
    } catch (err) {
      this.warnTable(err);
      return 'no_table';
    }
    return ok ? 'done' : 'failed';
  }

  private async logUsage(storeId: string, inTok: number, outTok: number): Promise<void> {
    try {
      const { costToman } = await this.pricing.calcCost(inTok, outTok, PERCEPTION_MODEL);
      await this.prisma.creditUsageEvent.create({
        data: { storeId, model: PERCEPTION_MODEL, kind: 'PRODUCT_ENRICHMENT', costToman, isFreeQuota: true },
      });
    } catch (err) {
      this.logger.warn(`product brief usage log failed: ${(err as Error).message}`);
    }
  }

  private warnTable(err: unknown): void {
    if (this.tableWarned) return;
    this.tableWarned = true;
    this.logger.warn(`product_brief unavailable (SQL 20261058 اجرا شده؟): ${(err as Error).message}`);
  }
}
