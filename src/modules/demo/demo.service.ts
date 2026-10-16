import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { fa } from '../../i18n/fa';
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
  ) {}

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
      include: { products: { where: { status: 'ACTIVE' } } },
    });
    if (!template) throw new NotFoundException(fa.demo.templateNotFound);

    const rateKey = dailyDemoRateKey();
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 24 * 60 * 60);
    if (count > DAILY_NEW_DEMO_STORE_CAP) {
      throw new BadRequestException(fa.errors.tooManyRequests);
    }

    const slug = `demo-${categorySlug}-${randomBytes(4).toString('hex')}`;
    const clone = await this.prisma.store.create({
      data: {
        sellerId: userId,
        slug,
        name: template.name,
        category: template.category,
        businessType: template.businessType,
        bankCardNumber: template.bankCardNumber,
        bankOwnerName: template.bankOwnerName,
        brandIntro: template.brandIntro,
        shippingInfo: template.shippingInfo,
        returnPolicy: template.returnPolicy,
        requiresShipping: template.requiresShipping,
        // DEMO-1 — leadCaptureOnly فقط برای صفحه‌ی ثبت‌نام خودِ نیوو است؛ دمو چت خریدارِ واقعی
        // همان دسته است (سفارش sandbox، DEMO-2)
        leadCaptureOnly: false,
        isDemo: true,
        clonedFromStoreId: template.id,
      },
    });

    await this.prisma.product.createMany({
      data: template.products.map((p) => ({
        storeId: clone.id,
        name: p.name,
        basePrice: p.basePrice,
        stock: p.stock,
        trackStock: p.trackStock,
        stockSetAt: p.stockSetAt,
        status: 'ACTIVE' as const,
        description: p.description,
        images: p.images,
        videos: p.videos as Prisma.InputJsonValue,
      })),
    });

    return { storeId: clone.id, slug: clone.slug };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۳ — دکمه‌ی «این رو
  // فروشگاه واقعی من کن»؛ همان رکورد Store می‌ماند، فقط فلگ isDemo برداشته می‌شود — محصولات
  // نمونه همان‌جا می‌مانند تا خودش ویرایش/حذفشان کند
  async convertToReal(userId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store || store.sellerId !== userId) {
      throw new NotFoundException(fa.store.notFound);
    }
    if (!store.isDemo) return store;
    return this.prisma.store.update({
      where: { id: storeId },
      data: { isDemo: false, leadCaptureOnly: false },
    });
  }
}
