// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۲ — فیلتر/مرتب‌سازی/شمارش روی کل
// کاتالوگ فعال فروشگاه در یک کوئری. واکشی کامل محصول و resolveProductPrices (منبع حقیقت قیمت
// نمایشی) عمداً در ConversationEngineService می‌ماند.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketPricesService } from '../../market-prices/market-prices.service';
import { find18kGoldItem } from '../../store/product-pricing.util';
import {
  buildFinderQuery,
  mapFinderRows,
  type FinderQueryResult,
} from './finder-sql';
import {
  normalizeFa,
  type FinderSpec,
  type StoreSearchProfile,
} from './finder-spec';

const PROFILE_TTL_MS = 10 * 60 * 1000;
const VOCAB_MAX_NAMES = 4;
const VOCAB_MAX_VALUES = 12;

export type FinderRun = FinderQueryResult & {
  g18: number | null;
  elapsedMs: number;
};

@Injectable()
export class ProductFinderService {
  private readonly logger = new Logger(ProductFinderService.name);
  private readonly profiles = new Map<
    string,
    { at: number; profile: StoreSearchProfile }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketPrices: MarketPricesService,
  ) {}

  /** پروفایل داده‌ی واقعی فروشگاه (کش ۱۰ دقیقه‌ای)؛ تعیین‌کننده‌ی پارامترهای قابل‌نمایش به مدل */
  async getProfile(
    storeId: string,
    category: string | null,
  ): Promise<StoreSearchProfile> {
    const hit = this.profiles.get(storeId);
    if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.profile;

    const [agg] = await this.prisma.$queryRaw<
      {
        has_gold: boolean | null;
        has_weight: boolean | null;
        catalog: number;
      }[]
    >(Prisma.sql`
      SELECT bool_or(pr."pricingModel" = 'WEIGHT_BASED_FORMULA') AS has_gold,
             (bool_or(pr."weightGrams" IS NOT NULL) OR bool_or(EXISTS (
                SELECT 1 FROM product_variants v WHERE v."productId" = pr.id AND v."weightGrams" IS NOT NULL))) AS has_weight,
             COUNT(*)::int AS catalog
      FROM products pr WHERE pr."storeId" = ${storeId} AND pr.status = 'ACTIVE'`);
    const vocabRows = await this.prisma.$queryRaw<
      { name: string; value: string; n: number }[]
    >(Prisma.sql`
      SELECT ot.name, ov.value, COUNT(*)::int AS n
      FROM product_option_types ot
      JOIN products pr ON pr.id = ot."productId"
      JOIN product_option_values ov ON ov."optionTypeId" = ot.id
      WHERE pr."storeId" = ${storeId} AND pr.status = 'ACTIVE'
      GROUP BY ot.name, ov.value`);

    const byName = new Map<
      string,
      { total: number; values: { v: string; n: number }[] }
    >();
    for (const r of vocabRows) {
      const e = byName.get(r.name) ?? { total: 0, values: [] };
      e.total += r.n;
      e.values.push({ v: r.value, n: r.n });
      byName.set(r.name, e);
    }
    const optionVocab = [...byName.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, VOCAB_MAX_NAMES)
      .map(([name, e]) => ({
        name,
        values: e.values
          .sort((a, b) => b.n - a.n)
          .slice(0, VOCAB_MAX_VALUES)
          .map((x) => x.v),
      }));

    const profile: StoreSearchProfile = {
      hasGold: !!agg?.has_gold,
      hasWeight: !!agg?.has_weight,
      catalogSize: agg?.catalog ?? 0,
      optionVocab,
      category: category ? normalizeFa(category) : null,
    };
    this.profiles.set(storeId, { at: Date.now(), profile });
    return profile;
  }

  /** نرخ هر گرم طلای ۱۸؛ null = در دسترس نیست (قیمت واحدهای طلا NULL می‌شود، هرگز حدس نمی‌زنیم) */
  private async gold18(): Promise<number | null> {
    try {
      const prices = await this.marketPrices.getGoldPrices();
      return find18kGoldItem(prices.items)?.price ?? null;
    } catch (err) {
      this.logger.warn(
        `gold price unavailable for finder: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async find(
    storeId: string,
    spec: FinderSpec,
    profile: StoreSearchProfile,
  ): Promise<FinderRun> {
    const g18 = profile.hasGold ? await this.gold18() : null;
    const started = Date.now();
    const raw = await this.prisma.$queryRaw<
      Parameters<typeof mapFinderRows>[0]
    >(buildFinderQuery(storeId, spec, g18));
    const elapsedMs = Date.now() - started;
    if (elapsedMs > 80) {
      this.logger.warn(
        `product finder slow: ${elapsedMs}ms store=${storeId} catalog=${profile.catalogSize}`,
      );
    }
    return { ...mapFinderRows(raw), g18, elapsedMs };
  }
}
