// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۸.۲ — oracle روی فیکسچر. فقط روی DB
// لوکال/dev اجرا می‌شود (اگر در دسترس نبود skip)؛ هرگز روی DB همروش. فیکسچر در یک فروشگاه موقت
// ساخته و در پایان پاک می‌شود.
import 'dotenv/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeDisplayPrice } from '../../store/product-pricing.util';
import { ProductFinderService } from './product-finder.service';
import { toFinderSpec, tokenizeQuery, type FinderSpec } from './finder-spec';

const G18 = 5_432_100;
const STORE_GOLD = {
  goldWageType: 'PERCENT' as const,
  goldWageValue: 8,
  goldProfitPercent: 5,
  goldVatPercent: 10,
};

let seed = 12345;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

// گارد پروداکشن: فقط وقتی DATABASE_URL لوکال است اجرا شود
const localDb = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const prisma = new PrismaService();
const marketPrices = {
  getGoldPrices: () =>
    Promise.resolve({
      items: [
        {
          symbol: 'IR_GOLD_18K',
          name: 'طلا ۱۸',
          name_en: '18K Gold',
          price: G18,
        },
      ],
      updatedAt: null,
      source: 'live',
    }),
};
const finder = new ProductFinderService(prisma, marketPrices as never);

let dbUp = false;
let storeId = '';
let sellerId = '';

type Unit = {
  productId: string;
  variantId: string | null;
  name: string;
  code: string | null;
  hay: string;
  opts: Record<string, string> | null;
  price: number | null;
  w: number | null;
  k: number | null;
  wagePct: number | null;
  inStock: boolean;
  createdAt: number;
};

async function loadUnits(): Promise<Unit[]> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  const products = await prisma.product.findMany({
    where: { storeId, status: 'ACTIVE' },
    include: { variants: true, optionTypes: true },
  });
  const units: Unit[] = [];
  const goldInfo = (
    p: (typeof products)[number],
    w: number | null,
    k: number | null,
  ) => {
    const type = p.goldWageType ?? store.goldWageType;
    const val = p.goldWageValue ?? store.goldWageValue;
    const profit = p.goldProfitPercent ?? store.goldProfitPercent;
    if (!w || !k || !type || val == null || profit == null)
      return { price: null, wagePct: null };
    return {
      price: null as number | null,
      wagePct: type === 'PERCENT' ? val : (val / ((k / 18) * G18)) * 100,
    };
  };
  for (const p of products) {
    const specText = Array.isArray(p.specs)
      ? (p.specs as { value: string }[]).map((s) => s.value).join(' ')
      : '';
    const mk = (
      v: (typeof p.variants)[number] | null,
      inStock: boolean,
    ): Unit => {
      const w = v?.weightGrams ?? p.weightGrams;
      const k = v?.purityKarat ?? p.purityKarat;
      let price: number | null;
      let wagePct: number | null = null;
      if (p.pricingModel === 'WEIGHT_BASED_FORMULA') {
        const g = goldInfo(p, w, k);
        wagePct = g.wagePct;
        price =
          g.wagePct === null
            ? null
            : computeDisplayPrice(
                {
                  pricingModel: p.pricingModel,
                  basePrice: p.basePrice,
                  weightGrams: p.weightGrams,
                  purityKarat: p.purityKarat,
                  goldWageType: p.goldWageType,
                  goldWageValue: p.goldWageValue,
                  goldProfitPercent: p.goldProfitPercent,
                },
                v
                  ? {
                      priceOverride: v.priceOverride,
                      weightGrams: v.weightGrams,
                      purityKarat: v.purityKarat,
                    }
                  : null,
                store,
                [
                  {
                    symbol: 'IR_GOLD_18K',
                    name: 'طلا ۱۸',
                    name_en: '18K Gold',
                    price: G18,
                  } as never,
                ],
              );
      } else price = v?.priceOverride ?? p.basePrice;
      const optText = v
        ? Object.values(v.optionValues as Record<string, string>).join(' ')
        : '';
      return {
        productId: p.id,
        variantId: v?.id ?? null,
        name: p.name,
        code: p.code,
        hay: `${p.name} ${p.code ?? ''} ${optText} ${specText}`.toLowerCase(),
        opts: v ? (v.optionValues as Record<string, string>) : null,
        price,
        w,
        k,
        wagePct,
        inStock,
        createdAt: p.createdAt.getTime(),
      };
    };
    if (p.optionTypes.length > 0 && p.variants.length > 0) {
      for (const v of p.variants)
        units.push(mk(v, !p.trackStock || v.stock > 0));
    } else if (p.optionTypes.length > 0) units.push(mk(null, false));
    else units.push(mk(null, !p.trackStock || p.stock > 0));
  }
  return units;
}

function oracle(units: Unit[], spec: FinderSpec, attr?: (u: Unit) => boolean) {
  const tokens = spec.query ? tokenizeQuery(spec.query) : [];
  const ok = units.filter(
    (u) =>
      (!spec.inStockOnly || u.inStock) &&
      (spec.minPrice === undefined ||
        (u.price !== null && u.price >= spec.minPrice)) &&
      (spec.maxPrice === undefined ||
        (u.price !== null && u.price <= spec.maxPrice)) &&
      (spec.minWeightGrams === undefined ||
        (u.w !== null && u.w >= spec.minWeightGrams)) &&
      (spec.maxWeightGrams === undefined ||
        (u.w !== null && u.w <= spec.maxWeightGrams)) &&
      (spec.maxWagePercent === undefined ||
        (u.wagePct !== null && u.wagePct <= spec.maxWagePercent)) &&
      (spec.karat === undefined || u.k === spec.karat) &&
      tokens.every((t) => u.hay.includes(t)) &&
      (!attr || attr(u)),
  );
  const keyOf = (u: Unit): number | null =>
    spec.sortBy === 'price'
      ? u.price
      : spec.sortBy === 'weight'
        ? u.w
        : spec.sortBy === 'wage'
          ? u.wagePct
          : u.createdAt;
  const dir =
    (spec.sortDir ??
      (spec.sortBy === 'newest' || !spec.sortBy ? 'desc' : 'asc')) === 'desc'
      ? -1
      : 1;
  const cmp = (a: Unit, b: Unit) => {
    const ka = keyOf(a),
      kb = keyOf(b);
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      return (ka - kb) * dir;
    }
    return 0;
  };
  const best = new Map<string, Unit>();
  for (const u of [...ok].sort(
    (a, b) =>
      cmp(a, b) ||
      Number(b.inStock) - Number(a.inStock) ||
      (a.price ?? 1e18) - (b.price ?? 1e18),
  )) {
    if (!best.has(u.productId)) best.set(u.productId, u);
  }
  const all = [...best.values()].sort(
    (a, b) =>
      cmp(a, b) ||
      b.createdAt - a.createdAt ||
      (a.productId < b.productId ? -1 : 1),
  );
  return {
    matched: all.length,
    ids: all
      .filter((u) => !spec.excludeIds.includes(u.productId))
      .slice(0, spec.limit)
      .map((u) => u.productId),
  };
}

const describeDb = localDb ? describe : describe.skip;

describeDb('ProductFinder oracle (DB لوکال)', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp = true;
    } catch {
      dbUp = false;
      return;
    }
    const seller = await prisma.user.findFirst({ select: { id: true } });
    if (!seller) {
      dbUp = false;
      return;
    }
    sellerId = seller.id;
    const store = await prisma.store.create({
      data: {
        sellerId,
        slug: `finder-test-${Date.now()}`,
        name: 'finder-test',
        ...STORE_GOLD,
      },
    });
    storeId = store.id;

    const ringNames = [
      'انگشتر ساده',
      'انگشتر نگین‌دار',
      'گردنبند ظریف',
      'دستبند کارتیه',
      'گوشواره حلقه‌ای',
    ];
    for (let i = 0; i < 90; i++) {
      const fixed = rand() < 0.5;
      await prisma.product.create({
        data: {
          storeId,
          name: `${pick(ringNames)} ${i}`,
          code: `G${i}`,
          basePrice: 0,
          pricingModel: 'WEIGHT_BASED_FORMULA',
          weightGrams: Math.round((0.5 + rand() * 9) * 10) / 10,
          purityKarat: pick([18, 18, 21, 24]),
          ...(i % 4 === 0
            ? {
                goldWageType: fixed ? 'FIXED_PER_GRAM' : 'PERCENT',
                goldWageValue: fixed
                  ? 200_000 + Math.floor(rand() * 400_000)
                  : Math.round(rand() * 20),
                goldProfitPercent: 7,
              }
            : {}),
          stock: i % 7 === 0 ? 0 : 5,
          trackStock: i % 11 !== 0,
          createdAt: new Date(Date.now() - i * 60_000),
        },
      });
    }
    const colors = ['مشکی', 'سفید', 'آبی'];
    const sizes = ['40', '41', '42', '142', '44'];
    for (let i = 0; i < 100; i++) {
      const p = await prisma.product.create({
        data: {
          storeId,
          name: `${pick(['تیشرت نخی', 'شلوار جین', 'کفش ورزشی'])} ${i}`,
          basePrice: 500_000 + Math.floor(rand() * 4_000_000),
          stock: 0,
          createdAt: new Date(Date.now() - (100 + i) * 60_000),
          optionTypes: {
            create: [
              {
                name: 'رنگ',
                position: 0,
                values: {
                  create: colors.map((value, position) => ({
                    value,
                    position,
                  })),
                },
              },
              {
                name: 'سایز',
                position: 1,
                values: {
                  create: sizes.map((value, position) => ({ value, position })),
                },
              },
            ],
          },
        },
      });
      const combos = new Set<string>();
      for (let j = 0; j < 4; j++) {
        const c = pick(colors),
          s = pick(sizes);
        if (combos.has(c + s)) continue;
        combos.add(c + s);
        await prisma.productVariant.create({
          data: {
            productId: p.id,
            optionValues: { رنگ: c, سایز: s },
            stock: rand() < 0.3 ? 0 : 3,
            priceOverride:
              rand() < 0.5 ? 500_000 + Math.floor(rand() * 4_000_000) : null,
          },
        });
      }
    }
    for (let i = 0; i < 50; i++) {
      await prisma.product.create({
        data: {
          storeId,
          name: `لوازم خانگی ${i}`,
          basePrice: 100_000 + Math.floor(rand() * 9_000_000),
          stock: i % 5 === 0 ? 0 : 4,
          specs: [{ label: 'جنس', value: pick(['استیل', 'پلاستیک']) }],
          createdAt: new Date(Date.now() - (200 + i) * 60_000),
        },
      });
    }
    // گزینه‌دار بدون هیچ واریانت
    await prisma.product.create({
      data: {
        storeId,
        name: 'بدون واریانت',
        basePrice: 1000,
        stock: 5,
        optionTypes: { create: [{ name: 'رنگ', position: 0 }] },
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (storeId) await prisma.store.delete({ where: { id: storeId } });
    await prisma.$disconnect();
  });

  const run = async (raw: Record<string, unknown>) => {
    const profile = await finder.getProfile(storeId, null);
    const { spec } = toFinderSpec(raw, profile);
    const got = await finder.find(storeId, spec, profile);
    const units = await loadUnits();
    const want = oracle(units, spec);
    return { got, want };
  };

  const cases: [string, Record<string, unknown>][] = [
    ['ارزان‌ترین', { sortBy: 'price' }],
    ['گران‌ترین', { sortBy: 'price', sortDir: 'desc' }],
    [
      'زیر ۲ گرم و اجرت ≤ ۱۰٪',
      { maxWeightGrams: 2, maxWagePercent: 10, sortBy: 'wage' },
    ],
    ['سبک‌ترین انگشتر', { query: 'انگشتر', sortBy: 'weight' }],
    [
      'عیار ۲۱ زیر ۳۰ میلیون',
      { karat: 21, maxPrice: 30_000_000, sortBy: 'price' },
    ],
    ['صفر نتیجه', { query: 'هیچی نیست اینجا' }],
    ['فقط موجود پیش‌فرض + newest', { sortBy: 'newest' }],
    ['ناموجودها هم', { inStockOnly: false, sortBy: 'price', limit: 8 }],
    [
      'ارقام فارسی در قیمت',
      { maxPrice: '۳۰۰۰۰۰۰', minPrice: '۱۰۰۰۰۰۰', sortBy: 'price' },
    ],
  ];
  it.each(cases)('%s', async (_n, raw) => {
    if (!dbUp) return;
    const { got, want } = await run(raw);
    expect(got.totalMatched).toBe(want.matched);
    expect(got.rows.map((r) => r.productId)).toEqual(want.ids);
  });

  it('مشکی سایز ۴۲ زیر ۳ میلیون: روی یک واریانت واحد؛ ۴۲ با ۱۴۲ قاطی نمی‌شود', async () => {
    if (!dbUp) return;
    const raw = {
      attributes: [
        { name: 'رنگ', value: 'مشکی' },
        { name: 'سایز', value: '۴۲' },
      ],
      maxPrice: 3_000_000,
      sortBy: 'price',
    };
    const attr = (u: Unit) => {
      return u.opts?.['رنگ'] === 'مشکی' && u.opts?.['سایز'] === '42';
    };
    const profile = await finder.getProfile(storeId, null);
    const { spec } = toFinderSpec(raw, profile);
    const got = await finder.find(storeId, spec, profile);
    const want = oracle(
      (await loadUnits()).filter((u) => u.variantId),
      spec,
      attr,
    );
    expect(got.rows.map((r) => r.productId)).toEqual(want.ids);
    expect(got.totalMatched).toBe(want.matched);
    for (const r of got.rows) {
      expect(r.opts).toMatchObject({ رنگ: 'مشکی', سایز: '42' });
      expect(r.price!).toBeLessThanOrEqual(3_000_000);
    }
  });

  it('excludeIds: totalMatched قبل از exclude شمرده می‌شود و صفحه‌ی بعد تکراری نیست', async () => {
    if (!dbUp) return;
    const profile = await finder.getProfile(storeId, null);
    const first = await finder.find(
      storeId,
      toFinderSpec({ sortBy: 'price' }, profile).spec,
      profile,
    );
    const second = await finder.find(
      storeId,
      toFinderSpec(
        { sortBy: 'price', excludeIds: first.rows.map((r) => r.productId) },
        profile,
      ).spec,
      profile,
    );
    expect(second.totalMatched).toBe(first.totalMatched);
    const a = new Set(first.rows.map((r) => r.productId));
    expect(second.rows.every((r) => !a.has(r.productId))).toBe(true);
    // وقتی همه exclude شوند هنوز آمار برمی‌گردد
    const all = await finder.find(
      storeId,
      {
        ...toFinderSpec({}, profile).spec,
        excludeIds: Array.from({ length: 1 }, () => 'x'),
        limit: 1,
      },
      profile,
    );
    expect(all.totalCatalog).toBeGreaterThan(200);
  });
  // §۱۱.۸ — اسم آزاد گزینه‌ی فروشنده («سایز پا») با اسم عمومی مدل («سایز») جور شود
  it('اسم گزینه‌ی آزاد: name «سایز» واریانتِ «سایز پا» را پیدا می‌کند', async () => {
    if (!dbUp) return;
    const p = await prisma.product.create({
      data: {
        storeId,
        name: 'صندل تابستانی',
        basePrice: 900_000,
        stock: 0,
        optionTypes: {
          create: [
            {
              name: 'سایز پا',
              position: 0,
              values: { create: [{ value: '37', position: 0 }] },
            },
          ],
        },
      },
    });
    await prisma.productVariant.create({
      data: { productId: p.id, optionValues: { 'سایز پا': '37' }, stock: 2 },
    });
    const profile = await finder.getProfile(`${storeId}-fresh`, null);
    const fresh = {
      ...profile,
      optionVocab: [{ name: 'سایز پا', values: ['37'] }],
    };
    const { spec } = toFinderSpec(
      { attributes: [{ name: 'سایز', value: '37' }] },
      fresh,
    );
    const got = await finder.find(storeId, spec, fresh);
    expect(got.rows.map((r) => r.productId)).toEqual([p.id]);
  });
});
