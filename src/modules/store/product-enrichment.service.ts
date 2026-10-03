import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { computeProductCompleteness } from './product-completeness.util';
import { fa } from '../../i18n/fa';

const PAGE_SIZE = 20;
const ACTIVE_DRAFT_STATUSES = [
  'PENDING_ADMIN_REVIEW',
  'PENDING_SELLER_REVIEW',
] as const;

// docs/PRD-seller-knowledge-base.md بخش ۹.۲ (دوم، مورد ۶) — «سقف تعداد در هر اجرا ثابت و
// بدون تنظیم‌پذیری» تا هزینه‌ی غیرمنتظره رخ ندهد؛ هم‌عدد PAGE_SIZE بالا هست ولی مفهوماً جدا
// (آن صفحه‌بندی لیست ادمین است، این سقف واقعی یک اجرای تکمیل گروهی فروشنده)
const SELLER_BULK_COMPLETE_CAP = 20;

// docs/PRD-admin-product-enrichment-review.md — چرخه‌ی عمر ProductEnrichmentDraft: تولید محتوا
// (StoreKbService.adminGenerateEnrichmentDraft) جدا از این سرویس است؛ این‌جا فقط lifecycle
// (لیست/ساخت/تایید/رد، هم سمت ادمین هم سمت فروشنده) مدیریت می‌شود
@Injectable()
export class ProductEnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly storeKb: StoreKbService,
  ) {}

  // کراس-فروشگاه، عمداً بدون getOwned — فقط ادمین این را صدا می‌زند (کنترلر گارد AdminGuard دارد)
  async adminListLowCompleteness(opts: { storeId?: string; page?: number }) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const products = await this.prisma.product.findMany({
      where: opts.storeId ? { storeId: opts.storeId } : undefined,
      include: { store: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۱ — همان الگوی groupBy یک‌باره‌ی
    // StoreService.relatedKbEntryCounts، فقط بدون فیلتر storeId (نسخه‌ی کراس-فروشگاه)
    const kbCounts = await this.prisma.storeKbEntry.groupBy({
      by: ['relatedProductId'],
      where: { isActive: true, relatedProductId: { not: null } },
      _count: { _all: true },
    });
    const kbCountByProduct = new Map(
      kbCounts.map((c) => [c.relatedProductId as string, c._count._all]),
    );
    const activeDrafts = await this.prisma.productEnrichmentDraft.findMany({
      where: { status: { in: [...ACTIVE_DRAFT_STATUSES] } },
      select: { productId: true, status: true },
    });
    const activeDraftByProduct = new Map(
      activeDrafts.map((d) => [d.productId, d.status]),
    );

    const withCompleteness = products
      .map((p) => ({
        id: p.id,
        name: p.name,
        storeId: p.storeId,
        storeName: p.store.name,
        completeness: computeProductCompleteness(
          p,
          kbCountByProduct.get(p.id) ?? 0,
        ),
        activeDraftStatus: activeDraftByProduct.get(p.id) ?? null,
      }))
      .filter((p) => p.completeness.percent < 100);

    const total = withCompleteness.length;
    const items = withCompleteness.slice(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE,
    );
    return { items, total, page, limit: PAGE_SIZE };
  }

  async adminCreateDraft(
    adminUserId: string,
    productId: string,
    opts:
      | { source: 'WEB_SEARCH' }
      | { source: 'ADMIN_RESOURCE'; resourceText: string },
  ) {
    const active = await this.prisma.productEnrichmentDraft.findFirst({
      where: { productId, status: { in: [...ACTIVE_DRAFT_STATUSES] } },
    });
    if (active) {
      throw new BadRequestException(fa.store.enrichmentActiveDraftExists);
    }
    const generated = await this.storeKb.adminGenerateEnrichmentDraft(
      productId,
      opts,
    );
    return this.prisma.productEnrichmentDraft.create({
      data: {
        productId,
        source: opts.source,
        adminResourceText:
          opts.source === 'ADMIN_RESOURCE' ? opts.resourceText : null,
        suggestedDescription: generated.suggestedDescription,
        suggestedQuestions: generated.suggestedQuestions,
        suggestedSpecs: generated.suggestedSpecs,
        sourceNote: generated.sourceNote,
        createdByAdminId: adminUserId,
      },
    });
  }

  async adminApproveDraft(draftId: string) {
    const draft = await this.getDraftInStatus(draftId, 'PENDING_ADMIN_REVIEW');
    return this.prisma.productEnrichmentDraft.update({
      where: { id: draft.id },
      data: { status: 'PENDING_SELLER_REVIEW', adminReviewedAt: new Date() },
    });
  }

  async adminRejectDraft(draftId: string) {
    const draft = await this.getDraftInStatus(draftId, 'PENDING_ADMIN_REVIEW');
    return this.prisma.productEnrichmentDraft.update({
      where: { id: draft.id },
      data: { status: 'ADMIN_REJECTED', adminReviewedAt: new Date() },
    });
  }

  async sellerGetPendingDraft(
    sellerId: string,
    storeId: string,
    productId: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.productEnrichmentDraft.findFirst({
      where: { productId, status: 'PENDING_SELLER_REVIEW' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // تایید فروشنده یک اکشن واحد است — مستقیم description واقعی را آپدیت می‌کند، نه فقط فرم را
  // پر می‌کند و منتظر دکمه‌ی ذخیره‌ی جدا می‌ماند (ریسک گم‌شدن تایید اگر فروشنده یادش برود Save بزند)
  async sellerApproveDraft(
    sellerId: string,
    storeId: string,
    productId: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const draft = await this.prisma.productEnrichmentDraft.findFirst({
      where: { productId, status: 'PENDING_SELLER_REVIEW' },
      orderBy: { createdAt: 'desc' },
    });
    if (!draft) throw new NotFoundException(fa.store.enrichmentDraftNotFound);
    const [, updatedProduct] = await this.prisma.$transaction([
      this.prisma.productEnrichmentDraft.update({
        where: { id: draft.id },
        data: { status: 'SELLER_APPROVED', sellerDecidedAt: new Date() },
      }),
      this.prisma.product.update({
        where: { id: productId },
        data: {
          description: draft.suggestedDescription,
          // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (سوم) — قبلاً suggestedSpecs فقط به متن
          // description چسبانده می‌شد؛ حالا جدا و ساختاریافته هم روی خودِ محصول ذخیره می‌شود
          specs: draft.suggestedSpecs ?? Prisma.DbNull,
        },
      }),
    ]);
    return updatedProduct;
  }

  async sellerRejectDraft(
    sellerId: string,
    storeId: string,
    productId: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const draft = await this.prisma.productEnrichmentDraft.findFirst({
      where: { productId, status: 'PENDING_SELLER_REVIEW' },
      orderBy: { createdAt: 'desc' },
    });
    if (!draft) throw new NotFoundException(fa.store.enrichmentDraftNotFound);
    return this.prisma.productEnrichmentDraft.update({
      where: { id: draft.id },
      data: { status: 'SELLER_REJECTED', sellerDecidedAt: new Date() },
    });
  }

  // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (دوم، مورد ۶) — نسخه‌ی scoped-به-فروشگاه
  // adminListLowCompleteness بالا؛ عمداً groupBy را دوباره این‌جا می‌نویسد (به‌جای فراخوان متد
  // خصوصی StoreService.relatedKbEntryCounts) — همون الگوی خودِ این فایل در adminListLowCompleteness
  async sellerListLowCompleteness(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    const products = await this.prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    const kbCounts = await this.prisma.storeKbEntry.groupBy({
      by: ['relatedProductId'],
      where: { storeId, isActive: true, relatedProductId: { not: null } },
      _count: { _all: true },
    });
    const kbCountByProduct = new Map(
      kbCounts.map((c) => [c.relatedProductId as string, c._count._all]),
    );
    return products
      .map((p) => ({
        id: p.id,
        name: p.name,
        completeness: computeProductCompleteness(
          p,
          kbCountByProduct.get(p.id) ?? 0,
        ),
      }))
      .filter((p) => p.completeness.percent < 100)
      .slice(0, SELLER_BULK_COMPLETE_CAP);
  }

  // تولید محتوا دقیقاً با همون متد تک‌محصولی StoreKbService.completeProductInfo انجام می‌شود —
  // یعنی cache لایه‌ی CanonicalProduct و منطق کسر اعتبار عیناً تکرار می‌شود، فقط در یک حلقه.
  // اگر اعتبار فروشگاه وسط حلقه تمام شود، completeProductInfo خودش exception می‌اندازد — همان
  // لحظه حلقه متوقف می‌شود (ادامه دادن بی‌فایده است، همه‌ی موارد بعدی هم همین خطا را می‌گیرند)
  async sellerBulkComplete(
    sellerId: string,
    storeId: string,
    withWebSearch: boolean,
  ) {
    const lowCompleteness = await this.sellerListLowCompleteness(
      sellerId,
      storeId,
    );
    const items: Array<{
      productId: string;
      productName: string;
      suggestedDescription?: string;
      suggestedQuestions?: string[];
      suggestedSpecs?: { label: string; value: string }[];
      sourceNote?: string;
      error?: string;
    }> = [];
    for (const p of lowCompleteness) {
      try {
        const result = await this.storeKb.completeProductInfo(
          sellerId,
          storeId,
          p.id,
          withWebSearch,
        );
        items.push({ productId: p.id, productName: p.name, ...result });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : fa.store.productNotFound;
        items.push({ productId: p.id, productName: p.name, error: message });
        if (
          withWebSearch &&
          message === fa.store.insufficientCreditForWebSearch
        ) {
          break;
        }
      }
    }
    return { items };
  }

  // جلوی double-submit از یک تب ادمین قدیمی/رفرش‌نشده را می‌گیرد — اکشن فقط روی وضعیت
  // دقیقاً مورد انتظار مجاز است
  private async getDraftInStatus(draftId: string, status: string) {
    const draft = await this.prisma.productEnrichmentDraft.findUnique({
      where: { id: draftId },
    });
    if (!draft) throw new NotFoundException(fa.store.enrichmentDraftNotFound);
    if (draft.status !== status) {
      throw new BadRequestException(fa.store.enrichmentDraftWrongStatus);
    }
    return draft;
  }
}
