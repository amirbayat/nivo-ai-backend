import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditUsageKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DateRange } from '../usage-analytics/usage-analytics.service';
import { StoreCreditDeductionService } from '../store-credit-engine/store-credit-deduction.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { fa } from '../../i18n/fa';

// docs/PRD-admin-seller-credit-overview.md — لیست فروشنده‌ها در ادمین با اعتبار/هزینه‌ی AI
// (Store.creditBalanceToman / CreditUsageEvent). فقط خواندن — منطق کسر/شارژ اعتبار
// (credit.service.ts, store-credit.service.ts) دست‌نخورده می‌ماند.
@Injectable()
export class AdminStoreCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deduction: StoreCreditDeductionService,
    private readonly audit: AdminAuditService,
  ) {}

  // R1.1 — تنظیم دستی اعتبار (شارژ یا کسر) با ممیزی؛ همه‌چیز در یک تراکنش با قفل ردیف فروشگاه
  async adjustCredit(params: {
    adminId: string;
    storeId: string;
    amountToman: number;
    reason: string;
  }) {
    const { adminId, storeId, amountToman, reason } = params;
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException(fa.store.notFound);
    const result = await this.prisma.$transaction(
      async (tx) => {
        let beforeToman: number;
        let afterToman: number;
        if (amountToman > 0) {
          const locked = await tx.$queryRaw<{ creditBalanceToman: number }[]>`
            SELECT "creditBalanceToman" FROM "stores" WHERE "id" = ${storeId} FOR UPDATE`;
          beforeToman = locked[0].creditBalanceToman;
          await this.deduction.applyTopup(tx, {
            storeId,
            source: 'ADMIN_MANUAL',
            amountToman,
          });
          afterToman = beforeToman + amountToman;
          await tx.creditUsageEvent.create({
            data: {
              storeId,
              model: 'admin-manual',
              kind: 'TOPUP',
              costToman: amountToman,
              chargedToman: amountToman,
              source: 'ADMIN_MANUAL',
              meta: { adminId, reason },
            },
          });
        } else {
          const debit = await this.deduction.applyAdminDebit(tx, {
            storeId,
            amountToman: -amountToman,
          });
          if (!debit) throw new BadRequestException(fa.admin.creditAdjustBelowFloor);
          beforeToman = debit.beforeToman;
          afterToman = debit.afterToman;
        }
        await this.audit.record(
          {
            adminId,
            action: 'CREDIT_ADJUST',
            targetType: 'STORE',
            targetId: storeId,
            before: { creditBalanceToman: beforeToman },
            after: { creditBalanceToman: afterToman, deltaToman: amountToman },
            reason,
          },
          tx,
        );
        return { beforeToman, afterToman };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await this.deduction.invalidateBalanceCache(storeId).catch(() => undefined);
    if (amountToman > 0) {
      await this.deduction.reevaluateBlockedConversations(storeId).catch(() => undefined);
    }
    return result;
  }

  getAuditLog(storeId: string) {
    return this.audit.listForTarget('STORE', storeId);
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — «لاگ تجمیعی» روی ادمین: جمع کل (نه فقط صفحه‌ی فعلی ۲۰تایی)
  // درآمد بسته‌ها در مقابل COGS واقعی AI، برای جواب به «چقدر سوده؟» بدون جمع دستی ردیف‌ها
  async getSummary(params: { range: DateRange }) {
    const [balances, usage] = await Promise.all([
      this.prisma.store.aggregate({
        _sum: { creditBalanceToman: true, trialCreditRemainingToman: true },
        _count: { id: true },
      }),
      this.prisma.creditUsageEvent.groupBy({
        by: ['kind', 'isFreeQuota', 'source'],
        where: { createdAt: { gte: params.range.from, lte: params.range.to } },
        _sum: { costToman: true, chargedToman: true },
        _count: { id: true },
      }),
    ]);

    let totalPurchasedToman = 0;
    let totalAiCostToman = 0;
    let totalChargedToman = 0;
    let freeQuotaEventsCount = 0;
    let paidEventsCount = 0;
    for (const row of usage) {
      const cogs = row._sum.costToman ?? 0;
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — بعد از اضافه‌شدن buyerCostMarkup/sellerCostMarkup، مبلغ
      // واقعاً کسرشده (chargedToman) دیگر با COGS خام (costToman) یکی نیست
      const charged = row._sum.chargedToman ?? 0;
      const count = row._count.id;
      if (row.kind === 'TOPUP') {
        // شارژ دستی ادمین فروش نیست
        if (row.source !== 'ADMIN_MANUAL') totalPurchasedToman += cogs;
        continue;
      }
      totalAiCostToman += cogs;
      if (row.isFreeQuota) {
        freeQuotaEventsCount += count;
      } else {
        totalChargedToman += charged;
        paidEventsCount += count;
      }
    }

    return {
      storeCount: balances._count.id,
      totalCreditBalanceToman: balances._sum.creditBalanceToman ?? 0,
      totalTrialCreditRemainingToman:
        balances._sum.trialCreditRemainingToman ?? 0,
      totalPurchasedToman,
      totalAiCostToman,
      totalChargedToman,
      freeQuotaEventsCount,
      paidEventsCount,
    };
  }

  async getStores(params: {
    search?: string;
    range: DateRange;
    page?: number;
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = 20;
    const where: Prisma.StoreWhereInput = params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { slug: { contains: params.search, mode: 'insensitive' } },
            { seller: { phone: { contains: params.search } } },
            {
              seller: {
                name: { contains: params.search, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};

    const [total, stores] = await Promise.all([
      this.prisma.store.count({ where }),
      this.prisma.store.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          creditBalanceToman: true,
          trialCreditRemainingToman: true,
          leadCaptureOnly: true,
          seller: { select: { phone: true, name: true } },
        },
      }),
    ]);

    const storeIds = stores.map((s) => s.id);
    // داخل بازه‌ی page فعلی فیلتر می‌شود، نه کل فروشگاه‌ها — جلوگیری از aggregate روی کل جدول
    const usageByStore = storeIds.length
      ? await this.prisma.creditUsageEvent.groupBy({
          by: ['storeId', 'kind', 'isFreeQuota'],
          where: {
            storeId: { in: storeIds },
            createdAt: { gte: params.range.from, lte: params.range.to },
          },
          _sum: { costToman: true, chargedToman: true },
          _count: { id: true },
        })
      : [];

    const byStore = new Map<string, typeof usageByStore>();
    for (const row of usageByStore) {
      const list = byStore.get(row.storeId) ?? [];
      list.push(row);
      byStore.set(row.storeId, list);
    }

    const items = stores.map((store) => {
      const rows = byStore.get(store.id) ?? [];
      const costByKind: Partial<Record<CreditUsageKind, number>> = {};
      let totalPurchasedToman = 0;
      // هزینه‌ی واقعی AI (COGS خام، شامل سهمیه‌ی رایگان) در برابر مبلغی که واقعاً از اعتبار کم
      // شده (بعد از buyerCostMarkup/sellerCostMarkup) — دو عدد متفاوت و هر دو معنادار
      let totalAiCostToman = 0;
      let totalChargedToman = 0;
      let freeQuotaEventsCount = 0;
      let paidEventsCount = 0;

      for (const row of rows) {
        const cogs = row._sum.costToman ?? 0;
        const charged = row._sum.chargedToman ?? 0;
        const count = row._count.id;
        if (row.kind === 'TOPUP') {
          totalPurchasedToman += cogs;
          continue;
        }
        totalAiCostToman += cogs;
        costByKind[row.kind] = (costByKind[row.kind] ?? 0) + cogs;
        if (row.isFreeQuota) {
          freeQuotaEventsCount += count;
        } else {
          totalChargedToman += charged;
          paidEventsCount += count;
        }
      }

      return {
        storeId: store.id,
        slug: store.slug,
        name: store.name,
        status: store.status,
        seller: store.seller,
        creditBalanceToman: store.creditBalanceToman,
        trialCreditRemainingToman: store.trialCreditRemainingToman,
        leadCaptureOnly: store.leadCaptureOnly,
        totalPurchasedToman,
        totalAiCostToman,
        totalChargedToman,
        costByKind,
        freeQuotaEventsCount,
        paidEventsCount,
      };
    });

    return { total, page, pageSize, items };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۶ — فقط همین متد
  // Store.leadCaptureOnly را می‌نویسد؛ هیچ endpoint فروشنده‌ای این فیلد را ندارد
  // (UpdateStoreDto عمداً این فیلد را ندارد)
  async setLeadCaptureOnly(storeId: string, enabled: boolean) {
    return this.prisma.store.update({
      where: { id: storeId },
      data: { leadCaptureOnly: enabled },
      select: { id: true, leadCaptureOnly: true },
    });
  }

  async getStoreCreditUsage(params: {
    storeId: string;
    range: DateRange;
    kind?: CreditUsageKind;
    page?: number;
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = 30;
    const where: Prisma.CreditUsageEventWhereInput = {
      storeId: params.storeId,
      createdAt: { gte: params.range.from, lte: params.range.to },
      ...(params.kind ? { kind: params.kind } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.creditUsageEvent.count({ where }),
      this.prisma.creditUsageEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          customerId: true,
          conversationId: true,
          model: true,
          kind: true,
          costToman: true,
          chargedToman: true,
          isFreeQuota: true,
          tokensInput: true,
          tokensOutput: true,
          costUsdMicros: true,
          createdAt: true,
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }
}
