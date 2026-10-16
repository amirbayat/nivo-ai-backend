import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StoreService } from '../store/store.service';
import { DEMO_PANEL_EVENT_NAMES, ProductEventService, type ProductEventName } from '../../common/analytics/product-event.service';
import { fa } from '../../i18n/fa';
import { DEMO_FAKE_CARD_NUMBER, DEMO_FAKE_CARD_OWNER } from '../../common/utils/store-mode';
import { DEMO_CATEGORY_SLUGS, isDemoCategorySlug } from './demo-categories';

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۲.۵ — سقف کل سشن دمو
// (کپی‌های تازه‌ساخته‌شده) در روز، جلوگیری از سوءاستفاده/بات؛ عمداً کانفیگ ساده (نه هاردکد
// در منطق پراکنده) تا بعداً با داده‌ی واقعی بدون دیپلوی جدید عوض شود
const DAILY_NEW_DEMO_STORE_CAP = 200;

function dailyDemoRateKey(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `demo:ensure:count:${today}`;
}

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storeService: StoreService,
    private readonly productEvents: ProductEventService,
  ) {}

  // DEMO-6 — رویدادهای پنل فروشنده در تور (فقط برای مالک همین فروشگاه دمو)
  async logPanelTourEvent(userId: string, storeId: string, name: string) {
    if (!(DEMO_PANEL_EVENT_NAMES as readonly string[]).includes(name)) {
      throw new BadRequestException();
    }
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { sellerId: true, isDemo: true, category: true } });
    if (!store || store.sellerId !== userId || !store.isDemo) throw new NotFoundException(fa.store.notFound);
    this.productEvents.log(name as ProductEventName, { storeId, userId }, { category: store.category });
    return { ok: true };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۱ — هر User حداکثر یک
  // کپی دمو به‌ازای هر دسته‌بندی دارد؛ بازدیدهای بعدی همان کپی را برمی‌گردانند (نه کپی تکراری)
  async ensureDemoStore(userId: string, categorySlug: string) {
    if (!isDemoCategorySlug(categorySlug)) {
      throw new BadRequestException(fa.demo.categoryInvalid);
    }
    const category = DEMO_CATEGORY_SLUGS[categorySlug];

    const existing = await this.prisma.store.findFirst({
      where: { sellerId: userId, isDemo: true, category },
    });
    if (existing) return { storeId: existing.id, slug: existing.slug };

    const template = await this.prisma.store.findFirst({
      where: { isDemoTemplate: true, category },
      include: {
        products: {
          where: { status: 'ACTIVE' },
          include: {
            optionTypes: { include: { values: true } },
            variants: true,
          },
        },
        kbEntries: { where: { isActive: true } },
        shippingRules: true,
        discountCodes: true,
      },
    });
    if (!template) throw new NotFoundException(fa.demo.templateNotFound);

    const rateKey = dailyDemoRateKey();
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 24 * 60 * 60);
    if (count > DAILY_NEW_DEMO_STORE_CAP) {
      throw new BadRequestException(fa.errors.tooManyRequests);
    }

    const slug = `demo-${categorySlug}-${randomBytes(4).toString('hex')}`;
    // DEMO-3 — کپی کامل داخل یک تراکنش؛ کارت بانکی همیشه ساختگی (DEMO-2)، هرگز شماره‌ی قالب
    const clone = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          sellerId: userId,
          slug,
          name: template.name,
          category: template.category,
          businessType: template.businessType,
          bankCardNumber: DEMO_FAKE_CARD_NUMBER,
          bankOwnerName: DEMO_FAKE_CARD_OWNER,
          brandIntro: template.brandIntro,
          shippingInfo: template.shippingInfo,
          returnPolicy: template.returnPolicy,
          returnPolicyMode: template.returnPolicyMode,
          returnWindowDays: template.returnWindowDays,
          returnShippingPaidBy: template.returnShippingPaidBy,
          requiresShipping: template.requiresShipping,
          shippingDaysMin: template.shippingDaysMin,
          shippingDaysMax: template.shippingDaysMax,
          workingHoursStart: template.workingHoursStart,
          workingHoursEnd: template.workingHoursEnd,
          logoImageKey: template.logoImageKey,
          persuasionTechniquesEnabled: template.persuasionTechniquesEnabled,
          goldWageType: template.goldWageType,
          goldWageValue: template.goldWageValue,
          goldProfitPercent: template.goldProfitPercent,
          goldVatPercent: template.goldVatPercent,
          // DEMO-1 — leadCaptureOnly فقط برای صفحه‌ی ثبت‌نام خودِ نیوو است؛ دمو چت خریدارِ
          // واقعی همان دسته است (سفارش sandbox، DEMO-2)
          leadCaptureOnly: false,
          isDemo: true,
          clonedFromStoreId: template.id,
        },
      });

      await tx.storeBankCard.create({
        data: { storeId: store.id, cardNumber: DEMO_FAKE_CARD_NUMBER, ownerName: DEMO_FAKE_CARD_OWNER },
      });

      const productIdMap = new Map<string, string>();
      for (const p of template.products) {
        const created = await tx.product.create({
          data: {
            storeId: store.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: p.stock,
            trackStock: p.trackStock,
            stockSetAt: p.stockSetAt,
            status: 'ACTIVE',
            description: p.description,
            images: p.images,
            videos: p.videos as Prisma.InputJsonValue,
            specs: (p.specs ?? undefined) as Prisma.InputJsonValue | undefined,
            code: p.code,
            hasFulfillmentDelay: p.hasFulfillmentDelay,
            persuasionTechniquesEnabled: p.persuasionTechniquesEnabled,
            pricingModel: p.pricingModel,
            weightGrams: p.weightGrams,
            purityKarat: p.purityKarat,
            goldWageType: p.goldWageType,
            goldWageValue: p.goldWageValue,
            goldProfitPercent: p.goldProfitPercent,
            optionTypes: {
              create: p.optionTypes.map((t) => ({
                name: t.name,
                position: t.position,
                values: { create: t.values.map((v) => ({ value: v.value, position: v.position })) },
              })),
            },
            // optionValues بر اساس «نام گزینه → مقدار» است، پس نیازی به map شناسه ندارد
            variants: {
              create: p.variants.map((v) => ({
                optionValues: v.optionValues as Prisma.InputJsonValue,
                priceOverride: v.priceOverride,
                stock: v.stock,
                sku: v.sku,
                weightGrams: v.weightGrams,
                purityKarat: v.purityKarat,
              })),
            },
          },
        });
        productIdMap.set(p.id, created.id);
      }

      for (const kb of template.kbEntries) {
        // آیتم دانشِ وابسته به محصولی که کپی نشده (غیرفعال) بی‌معناست
        if (kb.relatedProductId && !productIdMap.has(kb.relatedProductId)) continue;
        await tx.storeKbEntry.create({
          data: {
            storeId: store.id,
            kind: kb.kind,
            relatedProductId: kb.relatedProductId ? productIdMap.get(kb.relatedProductId) : null,
            question: kb.question,
            answer: kb.answer,
            tags: kb.tags as Prisma.InputJsonValue,
            embedding: (kb.embedding ?? undefined) as Prisma.InputJsonValue | undefined,
            embeddingModel: kb.embeddingModel,
            isActive: true,
          },
        });
      }

      if (template.shippingRules.length > 0) {
        await tx.storeShippingRule.createMany({
          data: template.shippingRules.map((r) => ({
            storeId: store.id,
            provinces: r.provinces,
            cost: r.cost,
            enabled: r.enabled,
          })),
        });
      }

      for (const d of template.discountCodes) {
        // کد مخصوص محصولِ کپی‌نشده، اگر null می‌شد عمومی می‌شد؛ پس رد می‌شود
        if (d.productId && !productIdMap.has(d.productId)) continue;
        await tx.storeDiscountCode.create({
          data: {
            storeId: store.id,
            code: d.code,
            kind: d.kind,
            value: d.value,
            maxRedemptions: d.maxRedemptions,
            expiresAt: d.expiresAt,
            isActive: d.isActive,
            minQuantity: d.minQuantity,
            productId: d.productId ? productIdMap.get(d.productId)! : null,
          },
        });
      }
      return store;
    });

    return { storeId: clone.id, slug: clone.slug };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۳ + DEMO-4 — دکمه‌ی «این رو
  // فروشگاه واقعی من کن»؛ همان رکورد Store می‌ماند ولی مثل ساخت فروشگاه تازه رفتار می‌کند:
  // اعتبار هدیه، پاک‌شدن کارت قالب، محصولات نمونه DRAFT، slug بدون «demo-»، رویداد و پذیرش قوانین
  async convertToReal(userId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store || store.sellerId !== userId) {
      throw new NotFoundException(fa.store.notFound);
    }
    if (!store.isDemo) return store;

    const existingReal = await this.prisma.store.count({
      where: { sellerId: userId, isDemo: false },
    });
    if (existingReal > 0) throw new ConflictException(fa.store.alreadyHasStore);

    const now = new Date();
    const trial = await this.storeService.newStoreTrialData(now);
    const suggestion = await this.storeService.suggestSlug(store.name);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.storeBankCard.deleteMany({ where: { storeId } });
      await tx.product.updateMany({ where: { storeId }, data: { status: 'DRAFT' } });
      return tx.store.update({
        where: { id: storeId },
        data: {
          isDemo: false,
          leadCaptureOnly: false,
          slug: suggestion.slug,
          bankCardNumber: null,
          bankOwnerName: null,
          ...trial,
        },
      });
    });
    this.storeService.afterRealStoreCreated(userId, updated, now, { fromDemo: true });
    this.productEvents.log('demo_converted', { storeId, userId }, { category: store.category });
    return updated;
  }
}
