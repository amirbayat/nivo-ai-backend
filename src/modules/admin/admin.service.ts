import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConversationState } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { PricingService } from '../usage/pricing.service';
import { UsageAnalyticsService } from '../usage-analytics/usage-analytics.service';
import { fa } from '../../i18n/fa';
import {
  AI_PLATFORMS,
  CreateModelDto,
  MODEL_TIERS,
  MODEL_TYPES,
  TOKENIZER_FAMILIES,
} from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { UpdateSalesAgentGlobalConfigDto } from './dto/update-sales-agent-global-config.dto';
import {
  computeConversationStats,
  getStuckConversationIds,
  type StatsGroupBy,
} from '../sales-agent/conversation-stats.util';
import {
  getSalesAgentGlobalConfig,
  invalidateSalesAgentGlobalConfigCache,
} from '../sales-agent/sales-agent-global-config.util';

const MODEL_IMPORT_COLUMNS = [
  'name',
  'displayName',
  'provider',
  'modelType',
  'inputPricePerM',
  'outputPricePerM',
  'supportsVision',
  'supportsImageGen',
  'supportsWebSearch',
  'supportsFileInput',
  'supportsVideoInput',
  'supportsAudioInput',
  'imageGenInputImagePricePerM',
  'imageGenOutputImagePricePerM',
  'imageGenQuality',
  'imageGenSize',
  'imageGenFlatPriceUsd',
  'imageGenFlatPriceUnit',
  'imageGenUseDirectApi',
  'imageGenRequiresInputImage',
  'videoGenPricePerSecondUsd',
  'videoGenAudioMultiplier',
  'videoGenSupportedDurationsSec',
  'videoGenSupportedSizes',
  'isActive',
  'sortOrder',
  'tier',
  'tokenizerFamily',
  'avgCharsPerToken',
  'description',
  'badges',
  'platform',
] as const;

function cellToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function cellToBoolean(value: unknown, fallback: boolean): boolean {
  const s = cellToString(value)?.toLowerCase();
  if (s === undefined) return fallback;
  if (['true', '1', 'yes', 'بله', 'فعال'].includes(s)) return true;
  if (['false', '0', 'no', 'خیر', 'غیرفعال'].includes(s)) return false;
  return fallback;
}

// در اکسل badges به‌صورت رشته‌ی جدا‌شده با کاما وارد می‌شود (مثل "trending,popular")
function cellToStringArray(value: unknown): string[] | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  return s
    .split(/[,،]/)
    .map((b) => b.trim())
    .filter(Boolean);
}

// videoGenSupportedDurationsSec هم مثل badges با کاما جدا می‌شود (مثل "4,6,8") ولی عدد است
function cellToNumberArray(value: unknown): number[] | undefined {
  const arr = cellToStringArray(value);
  if (arr === undefined) return undefined;
  return arr.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
}

// platform هم مثل badges با کاما جدا می‌شود (مثل "LIARA,OPENROUTER")، ولی فقط مقادیر معتبر
// enum را نگه می‌داریم — بقیه validate در CreateModelDto رد می‌شود
function cellToPlatformArray(
  value: unknown,
): (typeof AI_PLATFORMS)[number][] | undefined {
  const arr = cellToStringArray(value);
  if (arr === undefined) return undefined;
  return arr.map((p) => p.toUpperCase()) as (typeof AI_PLATFORMS)[number][];
}

function parseModelRow(raw: Record<string, unknown>) {
  return {
    name: cellToString(raw.name),
    displayName: cellToString(raw.displayName),
    provider: cellToString(raw.provider),
    modelType:
      (cellToString(raw.modelType)?.toUpperCase() as
        (typeof MODEL_TYPES)[number] | undefined) ?? undefined,
    inputPricePerM: cellToNumber(raw.inputPricePerM),
    outputPricePerM: cellToNumber(raw.outputPricePerM),
    supportsVision: cellToBoolean(raw.supportsVision, false),
    supportsImageGen: cellToBoolean(raw.supportsImageGen, false),
    supportsWebSearch: cellToBoolean(raw.supportsWebSearch, false),
    supportsFileInput: cellToBoolean(raw.supportsFileInput, false),
    supportsVideoInput: cellToBoolean(raw.supportsVideoInput, false),
    supportsAudioInput: cellToBoolean(raw.supportsAudioInput, false),
    imageGenInputImagePricePerM: cellToNumber(raw.imageGenInputImagePricePerM),
    imageGenOutputImagePricePerM: cellToNumber(
      raw.imageGenOutputImagePricePerM,
    ),
    imageGenQuality: cellToString(raw.imageGenQuality),
    imageGenSize: cellToString(raw.imageGenSize),
    imageGenFlatPriceUsd: cellToNumber(raw.imageGenFlatPriceUsd),
    imageGenFlatPriceUnit: cellToString(raw.imageGenFlatPriceUnit),
    imageGenUseDirectApi: cellToBoolean(raw.imageGenUseDirectApi, false),
    videoGenPricePerSecondUsd: cellToNumber(raw.videoGenPricePerSecondUsd),
    videoGenAudioMultiplier: cellToNumber(raw.videoGenAudioMultiplier),
    videoGenSupportedDurationsSec: cellToNumberArray(
      raw.videoGenSupportedDurationsSec,
    ),
    videoGenSupportedSizes: cellToStringArray(raw.videoGenSupportedSizes),
    isActive: cellToBoolean(raw.isActive, true),
    sortOrder: cellToNumber(raw.sortOrder),
    tier:
      (cellToString(raw.tier)?.toUpperCase() as
        (typeof MODEL_TIERS)[number] | undefined) ?? undefined,
    tokenizerFamily: cellToString(raw.tokenizerFamily) as
      (typeof TOKENIZER_FAMILIES)[number] | undefined,
    avgCharsPerToken: cellToNumber(raw.avgCharsPerToken),
    description: cellToString(raw.description),
    badges: cellToStringArray(raw.badges),
    platform: cellToPlatformArray(raw.platform),
  };
}

type LimitType = 'daily' | '1h' | '3h' | '6h';

const LIMIT_TTL: Record<LimitType, number> = {
  '1h': 3_600,
  '3h': 10_800,
  '6h': 21_600,
  daily: 86_400,
};

function manualLimitKey(userId: string) {
  return `manual_limit:${userId}`;
}

// docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۴.۱ — یک taxonomy واحد با فیلد journey_stage،
// نه چند taxonomy جدا؛ اینجا همان نگاشت گروه‌های ثابت بخش ۳ (A-D,G پیش‌از‌خرید؛ E پرداخت؛
// F پس‌از‌خرید) روی BuyerNeedTag برای ستون journey_stage صفحه‌ی کشف ادمین (بخش ۵.۲)
const PAYMENT_STAGE_TAGS = new Set(['PAYMENT_ISSUE']);
const POST_PURCHASE_STAGE_TAGS = new Set(['POST_PURCHASE_SUPPORT']);

function buyerNeedJourneyStage(
  tag: string,
): 'PRE_PURCHASE' | 'PAYMENT' | 'POST_PURCHASE' {
  if (PAYMENT_STAGE_TAGS.has(tag)) return 'PAYMENT';
  if (POST_PURCHASE_STAGE_TAGS.has(tag)) return 'POST_PURCHASE';
  return 'PRE_PURCHASE';
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly aiShare: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly aiProvider: AiProviderService,
    private readonly pricingService: PricingService,
    private readonly usageAnalytics: UsageAnalyticsService,
  ) {
    // همون درصدی که PricingService برای بودجه‌ی واقعی مصرف می‌کند — برای اینکه
    // «انتظار مصرف» ادمین با محدودیت واقعی چت هماهنگ بماند، نه یک 0.7 هاردکد جدا
    this.aiShare = Number(this.config.get('AI_BUDGET_SHARE', '0.70'));
  }

  async getDashboard() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      totalUsers,
      activeUsers,
      revenueAll,
      revenueMrr,
      // docs/PRD-admin-credit-reports.md فاز ۲ — درآمد خرید بسته‌ی نیوو این ماه، جدا از mrr
      // قدیمی (که کل Payment.amount را بدون تفکیک نوع جمع می‌زند). بعد از قطع کامل پلن ماهانه
      // (docs/PRD-discovery-and-credits.md بخش ۲.۲)، mrr مفهوم اشتراک ماهانه را دیگر نمایندگی
      // نمی‌کند — creditRevenueToman جایگزین معنادار برای «درآمد ماهانه» است.
      creditRevenueMrr,
      totalConversations,
      todayConversations,
      exchangeRate,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          conversations: { some: { lastMessageAt: { gte: thirtyDaysAgo } } },
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          packageId: { not: null },
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      this.exchangeRate.getRateInfo(),
    ]);

    return {
      totalUsers,
      activeUsers,
      totalRevenue: revenueAll._sum.amount ?? 0,
      mrr: revenueMrr._sum.amount ?? 0,
      creditRevenueToman: creditRevenueMrr._sum.amount ?? 0,
      totalConversations,
      todayConversations,
      exchangeRate,
      // docs/EXECUTION-PLAN.md قدم ۷ — نشانگر provider فعلی؛ همون env که همه‌جای بک‌اند تصمیم
      // provider را می‌گیرد (AiProviderService)، نه یک منبع جدا که ممکنه دیرگ‌ه‌ازپیش‌شود
      aiProvider: this.aiProvider.name,
    };
  }

  async getUsers(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where = search ? { phone: { contains: search } } : {};

    const now = new Date();
    // «شارژ ماه» (chargedThisMonth) عمداً تقویمی می‌ماند — یک گزارش مالی «این ماه چقدر واریزی
    // داشتیم» است، نه معیار pacing per-user. برای expectedByNow/aiCostThisMonth اما، چون
    // با هم مقایسه می‌شوند، هر دو باید یک پنجره‌ی مشترک داشته باشند: دوره‌ی جاری اشتراک همون
    // کاربر (periodStart) اگر مشترک باشد، وگرنه (کاربر رایگان، بدون periodStart) همون قرارداد
    // قبلی یعنی اول ماه میلادی.
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const [users, total, monthlyRevenue, imageModelNames] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              periodEnd: true,
              periodStart: true,
              plan: { select: { name: true, priceMonthly: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.payment.groupBy({
        by: ['userId'],
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.usageAnalytics.getImageModelNames(),
    ]);

    const revenueMap = new Map(
      monthlyRevenue.map((r) => [r.userId, r._sum.amount ?? 0]),
    );

    // پنجره‌ی مصرف هر کاربر می‌تواند متفاوت باشد (هرکس periodStart خودش را دارد)، پس دیگر
    // نمی‌شود یک groupBy مشترک زد — قدیمی‌ترین شروع‌پنجره‌ی بین کاربرهای همین صفحه را پیدا
    // می‌کنیم، ردیف‌های خام را از آنجا می‌گیریم، و بعد به‌ازای هر کاربر خودمان جمع می‌زنیم.
    const windowStartFor = (u: (typeof users)[number]) =>
      u.subscription ? startOfDay(u.subscription.periodStart) : startOfMonth;
    const earliestWindowStart = users.reduce((min, u) => {
      const s = windowStartFor(u);
      return s < min ? s : min;
    }, startOfMonth);

    const userIds = users.map((u) => u.id);
    const [usageRows, messageRows, creditDebitRows, creditConfig] =
      await Promise.all([
        this.prisma.dailyUsage.findMany({
          where: {
            userId: { in: userIds },
            date: { gte: earliestWindowStart },
          },
          select: {
            userId: true,
            date: true,
            costToman: true,
            costUsdMicros: true,
          },
        }),
        // برای تفکیک مصرف متن/عکس نیاز به سطح پیام داریم — DailyUsage این تفکیک را
        // نگه نمی‌دارد (فقط جمع کل روزانه)
        this.prisma.message.findMany({
          where: {
            userId: { in: userIds },
            role: 'ASSISTANT',
            model: { not: null },
            createdAt: { gte: earliestWindowStart },
          },
          select: {
            userId: true,
            model: true,
            costToman: true,
            costUsdMicros: true,
            createdAt: true,
          },
        }),
        // docs/PRD-admin-credit-reports.md فاز ۴ — مصرف نیوو (کیف‌پول) هر کاربر؛ برای کاربر
        // فقط‌نیوویی (بدون پلن ماهانه‌ی پولی) معیار heavy/moderate/light پایین‌تر (که مبتنی بر
        // priceMonthly است) بی‌معنی می‌شود — این مقدار موازی، مستقل از آن، کنارش گزارش می‌شود
        this.prisma.walletTransaction.findMany({
          where: {
            type: 'DEBIT',
            createdAt: { gte: earliestWindowStart },
            wallet: { userId: { in: userIds } },
          },
          select: {
            amountToman: true,
            createdAt: true,
            wallet: { select: { userId: true } },
          },
        }),
        this.prisma.creditConfig.findUnique({ where: { id: 'singleton' } }),
      ]);
    const tomanPerCredit = creditConfig?.tomanPerCredit ?? 1200;

    const enriched = users.map((u) => {
      const windowStart = windowStartFor(u);
      const rowsForUser = usageRows.filter(
        (r) => r.userId === u.id && r.date >= windowStart,
      );
      const aiCost = rowsForUser.reduce((sum, r) => sum + r.costToman, 0);
      const aiCostUsd =
        rowsForUser.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000;
      const charged = revenueMap.get(u.id) ?? 0;

      const msgRowsForUser = messageRows.filter(
        (r) => r.userId === u.id && r.createdAt >= windowStart,
      );
      const textRows = msgRowsForUser.filter(
        (r) => !imageModelNames.has(r.model as string),
      );
      const imageRows = msgRowsForUser.filter((r) =>
        imageModelNames.has(r.model as string),
      );
      const aiCostTextThisMonth = textRows.reduce(
        (sum, r) => sum + r.costToman,
        0,
      );
      const aiCostImageThisMonth = imageRows.reduce(
        (sum, r) => sum + r.costToman,
        0,
      );
      const aiCostTextUsdThisMonth =
        textRows.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000;
      const aiCostImageUsdThisMonth =
        imageRows.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000;

      // docs/PRD-admin-credit-reports.md فاز ۴ — مصرف نیوو مستقل از پنجره/بودجه‌ی پلن ماهانه
      const creditConsumedTomanThisMonth = creditDebitRows
        .filter((r) => r.wallet.userId === u.id && r.createdAt >= windowStart)
        .reduce((sum, r) => sum + r.amountToman, 0);
      const creditConsumedCreditsThisMonth = Math.floor(
        creditConsumedTomanThisMonth / tomanPerCredit,
      );

      const priceMonthly = u.subscription?.plan.priceMonthly ?? 0;
      const monthlyBudget = Math.floor(priceMonthly * this.aiShare);

      let daysInPeriod: number;
      let daysPassed: number;
      if (u.subscription) {
        const { periodStart, periodEnd } = u.subscription;
        daysInPeriod = Math.max(
          1,
          Math.round(
            (periodEnd.getTime() - periodStart.getTime()) / 86_400_000,
          ),
        );
        const rawDaysPassed =
          Math.floor((now.getTime() - periodStart.getTime()) / 86_400_000) + 1;
        daysPassed = Math.min(Math.max(rawDaysPassed, 1), daysInPeriod);
      } else {
        // کاربر رایگان — بدون دوره‌ی اشتراک؛ چون priceMonthly=۰ است budget عملاً صفر می‌شود،
        // اما برای پایداری فرمول همون قرارداد قبلی (ماه میلادی) را نگه می‌داریم
        daysInPeriod = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
        ).getDate();
        daysPassed = now.getDate();
      }

      const expectedByNow = Math.floor(
        (monthlyBudget * daysPassed) / daysInPeriod,
      );
      const ratio = expectedByNow > 0 ? aiCost / expectedByNow : 0;

      // این دسته‌بندی فقط برای کاربران با پلن ماهانه‌ی پولی/PAYG معنادار است (بر مبنای
      // priceMonthly/expectedByNow) — برای کاربر فقط‌نیوویی (priceMonthly=۰، بدون بودجه‌ی
      // تعریف‌شده) monthlyBudget همیشه صفر است و این کاربر همیشه در بهترین حالت «light»
      // می‌افتد، فارغ از میزان واقعی مصرف نیوویش. برای آن دسته، creditConsumedTomanThisMonth/
      // creditConsumedCreditsThisMonth بالا معیار موازی و واقعی مصرف است (docs/PRD-admin-credit-reports.md فاز ۴).
      let category: 'heavy' | 'moderate' | 'light' | 'inactive' = 'inactive';
      if (aiCost > 0) {
        if (ratio >= 1.5) category = 'heavy';
        else if (ratio >= 0.5) category = 'moderate';
        else category = 'light';
      }

      this.logger.log(
        `[expectedByNow] user=${u.phone} plan=${u.subscription?.plan.name ?? 'بدون اشتراک'} ` +
          `periodStart=${u.subscription?.periodStart.toISOString() ?? '- (رایگان، اول ماه میلادی)'} ` +
          `periodEnd=${u.subscription?.periodEnd.toISOString() ?? '-'} daysInPeriod=${daysInPeriod} daysPassed=${daysPassed} ` +
          `priceMonthly=${priceMonthly} monthlyBudget=floor(${priceMonthly} × ${this.aiShare})=${monthlyBudget} ` +
          `expectedByNow=floor(${monthlyBudget} × ${daysPassed} / ${daysInPeriod})=${expectedByNow} ` +
          `aiCostThisPeriod=${aiCost} (پنجره از ${windowStart.toISOString()} تا الان) ratio=${ratio.toFixed(3)} category=${category}`,
      );

      return {
        ...u,
        chargedThisMonth: charged,
        aiCostThisMonth: aiCost,
        aiCostUsdThisMonth: aiCostUsd,
        aiCostTextThisMonth,
        aiCostImageThisMonth,
        aiCostTextUsdThisMonth,
        aiCostImageUsdThisMonth,
        expectedByNow,
        category,
        creditConsumedTomanThisMonth,
        creditConsumedCreditsThisMonth,
      };
    });

    return { users: enriched, total, page, limit };
  }

  // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۵ — اولین drill-down واقعی این صفحه؛ قبلاً فقط
  // جدول تخت بود، wallet هم اصلاً select نمی‌شد
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lifetimeMessageCount: true,
        subscription: {
          select: {
            status: true,
            periodStart: true,
            periodEnd: true,
            plan: true,
          },
        },
        wallet: { select: { id: true, balanceToman: true } },
      },
    });
    if (!user) throw new NotFoundException(fa.users.notFound);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 29 * 86_400_000);

    const [
      walletTransactions,
      payments,
      dailyUsage,
      modelBreakdown,
      creativeGenerations,
      messages,
    ] = await Promise.all([
      user.wallet
        ? this.prisma.walletTransaction.findMany({
            where: { walletId: user.wallet.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : [],
      this.prisma.payment.findMany({
        where: { userId },
        include: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.dailyUsage.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 30,
      }),
      // تفکیک مصرف متن/عکس ۳۰ روز اخیر — همون منطق modelType که در صفحه‌ی
      // «آنالیز مصرف» استفاده می‌شود، اینجا برای یک کاربر خاص
      this.usageAnalytics.getModelBreakdown(
        { from: thirtyDaysAgo, to: now },
        userId,
      ),
      // docs/PRD-admin-credit-reports.md فاز ۳ — تاریخچه‌ی مصرف دیسکاوری/کریتیو کاربر؛ قبلاً
      // این صفحه فقط کیف‌پول/چت را می‌دید، هیچ ردی از تولیدهای نیوویی نبود
      this.prisma.creativeGeneration.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { prompt: { select: { title: true, outputType: true } } },
      }),
      // هزینه‌ی per-message — نرخ دلار همون لحظه از costToman/costUsdMicros قابل استخراج است
      // (هر دو با یک نرخ محاسبه شده‌اند)؛ openrouterRealCost* فقط وقتی provider=OPENROUTER
      // بوده پر می‌شود، برای مقایسه‌ی تخمین داخلی با هزینه‌ی واقعی گزارش‌شده توسط OpenRouter
      this.prisma.message.findMany({
        where: { userId, role: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          model: true,
          costToman: true,
          costUsdMicros: true,
          openrouterRealCostUsdMicros: true,
          openrouterRealCostToman: true,
        },
      }),
    ]);

    // تراکنش‌های DEBIT ناشی از چت، metadata.messageId دارند (chat.service.ts) — برای نمایش
    // هزینه‌ی واقعی OpenRouter/نرخ دلار همون لحظه کنار هر تراکنش، به همون پیام join می‌زنیم.
    // تراکنش‌های دیگر (بازگشت وجه، شارژ، دیسکاوری/کریتیو) پیوند پیامی ندارند و message=null می‌مانند.
    const linkedMessageIds = walletTransactions
      .map((t) => (t.metadata as { messageId?: string } | null)?.messageId)
      .filter((id): id is string => Boolean(id));
    const linkedMessages = linkedMessageIds.length
      ? await this.prisma.message.findMany({
          where: { id: { in: linkedMessageIds } },
          select: {
            id: true,
            model: true,
            costToman: true,
            costUsdMicros: true,
            openrouterRealCostUsdMicros: true,
            openrouterRealCostToman: true,
          },
        })
      : [];
    const linkedMessageById = new Map(linkedMessages.map((m) => [m.id, m]));
    const walletTransactionsWithMessage = walletTransactions.map((t) => {
      const metadata = t.metadata as {
        messageId?: string;
        costToman?: number;
        costUsdMicros?: number;
        openrouterRealCostUsdMicros?: number;
      } | null;
      const linked = linkedMessageById.get(metadata?.messageId ?? '') ?? null;
      // تراکنش‌های video-studio (studio-video-generation.processor.ts) پیام‌ی در کار
      // نیست که join بزنیم — چون video-studio از مدل Message استفاده نمی‌کند — پس اگر
      // متادیتا خودش هزینه‌ی دلاری را مستقیم حمل می‌کند، همون شکل «message» را از رویش
      // می‌سازیم تا همون ستون فرانت ادمین (که message.openrouterRealCostUsdMicros را
      // می‌خواند) بدون تغییر برای ویدیو هم کار کند.
      const message =
        linked ??
        (metadata?.costUsdMicros != null ||
        metadata?.openrouterRealCostUsdMicros != null
          ? {
              id: null,
              model: null,
              costToman: metadata.costToman ?? null,
              costUsdMicros: metadata.costUsdMicros ?? null,
              openrouterRealCostUsdMicros:
                metadata.openrouterRealCostUsdMicros ?? null,
              openrouterRealCostToman: null,
            }
          : null);
      return { ...t, message };
    });

    const sumTypeUsage = (rows: typeof modelBreakdown) => ({
      messages: rows.reduce((s, r) => s + r.messages, 0),
      tokensInput: rows.reduce((s, r) => s + r.tokensInput, 0),
      tokensOutput: rows.reduce((s, r) => s + r.tokensOutput, 0),
      costToman: rows.reduce((s, r) => s + r.costToman, 0),
      costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
      // modelBreakdown از قبل بر اساس costToman نزولی مرتب است
      mostUsedModel: rows[0]?.model ?? null,
    });

    return {
      user,
      walletBalanceToman: user.wallet?.balanceToman ?? 0,
      walletTransactions: walletTransactionsWithMessage,
      payments,
      dailyUsage,
      creativeGenerations,
      messages,
      textUsage: sumTypeUsage(
        modelBreakdown.filter((m) => m.modelType === 'TEXT'),
      ),
      imageUsage: sumTypeUsage(
        modelBreakdown.filter((m) => m.modelType === 'IMAGE'),
      ),
    };
  }

  async updateUser(
    userId: string,
    data: { isActive?: boolean; role?: 'USER' | 'ADMIN' },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(fa.admin.userNotFound);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, phone: true, name: true, role: true, isActive: true },
    });

    return { message: fa.admin.userUpdated, user: updated };
  }

  async getTokenStats() {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayStats, monthStats] = await Promise.all([
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfToday } },
        _sum: {
          freeTokensUsed: true,
          paidTokensUsed: true,
          requestsCount: true,
        },
      }),
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfMonth } },
        _sum: { freeTokensUsed: true, paidTokensUsed: true },
      }),
    ]);

    return {
      today: {
        totalFree: todayStats._sum.freeTokensUsed ?? 0,
        totalPaid: todayStats._sum.paidTokensUsed ?? 0,
        requests: todayStats._sum.requestsCount ?? 0,
      },
      thisMonth: {
        totalFree: monthStats._sum.freeTokensUsed ?? 0,
        totalPaid: monthStats._sum.paidTokensUsed ?? 0,
      },
    };
  }

  async getCostChart(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const [
      costRows,
      revenueRows,
      liaraRows,
      discoveryCostRows,
      openrouterRows,
    ] = await Promise.all([
      this.prisma.dailyUsage.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        _sum: { costToman: true, costUsdMicros: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; revenue: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount)::bigint AS revenue
        FROM payments
        WHERE status = 'COMPLETED' AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
      this.prisma.liaraUsageSnapshot.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        _sum: { realCostToman: true },
        orderBy: { date: 'asc' },
      }),
      // docs/PRD-admin-credit-reports.md فاز ۲ — هزینه‌ی روزانه‌ی دیسکاوری/کریتیو، قبلاً در
      // این نمودار اصلاً دیده نمی‌شد (فقط DailyUsage چت جمع زده می‌شد)
      this.prisma.$queryRaw<Array<{ day: Date; cost: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM("costToman")::bigint AS cost
        FROM creative_generations
        WHERE status = 'SUCCEEDED' AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
      // معادل liaraRows بالا برای OpenRouter — از Message (per-request) نه اسنپ‌شات جدا، پس
      // raw query لازم است (groupBy معمولی روی تاریخ کامل createdAt، نه روز، کار می‌کرد)
      this.prisma.$queryRaw<Array<{ day: Date; cost: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM("openrouterRealCostToman")::bigint AS cost
        FROM messages
        WHERE role = 'ASSISTANT' AND "openrouterRealCostToman" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
    ]);

    const revenueMap = new Map(
      revenueRows.map((r) => [
        r.day.toISOString().slice(0, 10),
        Number(r.revenue),
      ]),
    );
    // نبود رکورد یعنی هنوز کلید اختصاصی لیارا برای هیچ کاربری فعال نبوده — null نه صفر
    const liaraMap = new Map(
      liaraRows.map((r) => [
        r.date.toISOString().slice(0, 10),
        r._sum.realCostToman ?? 0,
      ]),
    );
    const discoveryCostMap = new Map(
      discoveryCostRows.map((r) => [
        r.day.toISOString().slice(0, 10),
        Number(r.cost),
      ]),
    );
    // نبود رکورد یعنی هنوز پیامی روی OpenRouter با cost واقعی نداشتیم — null نه صفر (مثل liaraMap)
    const openrouterMap = new Map(
      openrouterRows.map((r) => [
        r.day.toISOString().slice(0, 10),
        Number(r.cost),
      ]),
    );
    const chatCostMap = new Map(
      costRows.map((r) => [
        r.date.toISOString().slice(0, 10),
        {
          costToman: r._sum.costToman ?? 0,
          costUsdMicros: r._sum.costUsdMicros ?? 0,
        },
      ]),
    );

    // قبلاً این نمودار فقط روزهایی را نشان می‌داد که DailyUsage (چت) رکورد داشت — یک روز با
    // فقط مصرف دیسکاوری/کریتیو (بدون هیچ پیام چت) اصلاً در نمودار ظاهر نمی‌شد. اتحاد تاریخ‌ها
    // از هر دو منبع این را برطرف می‌کند.
    const allDates = Array.from(
      new Set([...chatCostMap.keys(), ...discoveryCostMap.keys()]),
    ).sort();

    return allDates.map((date) => {
      const chat = chatCostMap.get(date);
      const chatCostToman = chat?.costToman ?? 0;
      const discoveryCostToman = discoveryCostMap.get(date) ?? 0;
      return {
        date,
        aiCostToman: chatCostToman + discoveryCostToman, // حالا شامل چت + دیسکاوری/کریتیو
        chatAiCostToman: chatCostToman,
        discoveryAiCostToman: discoveryCostToman,
        aiCostUsd: (chat?.costUsdMicros ?? 0) / 1_000_000,
        revenueToman: revenueMap.get(date) ?? 0,
        liaraCostToman: liaraMap.get(date) ?? null,
        openrouterCostToman: openrouterMap.get(date) ?? null,
      };
    });
  }

  async getPricingAlert() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [revenueRow, costRow, discoveryCostRow] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfMonth } },
        _sum: { costToman: true, costUsdMicros: true },
      }),
      // docs/PRD-admin-credit-reports.md فاز ۲ — قبل از این، هزینه‌ی دیسکاوری/کریتیو (تصویر و
      // متن نیوویی) اصلاً در این alert دیده نمی‌شد و فقط هزینه‌ی چت (DailyUsage) حساب می‌شد
      this.prisma.creativeGeneration.aggregate({
        where: { status: 'SUCCEEDED', createdAt: { gte: startOfMonth } },
        _sum: { costToman: true },
      }),
    ]);

    const monthlyRevenue = revenueRow._sum.amount ?? 0;
    const monthlyChatAiCost = costRow._sum.costToman ?? 0;
    const monthlyDiscoveryAiCost = discoveryCostRow._sum.costToman ?? 0;
    const monthlyAiCost = monthlyChatAiCost + monthlyDiscoveryAiCost;
    const monthlyAiCostUsd = (costRow._sum.costUsdMicros ?? 0) / 1_000_000;
    const ratio = monthlyRevenue > 0 ? monthlyAiCost / monthlyRevenue : 0;

    let alertLevel: 'safe' | 'warning' | 'critical' = 'safe';
    let suggestion: string | null = null;

    if (ratio >= 0.75) {
      alertLevel = 'critical';
      const targetRatio = 0.55; // aim to bring cost down to 55% of revenue
      const suggestedMultiplier = ratio / targetRatio;
      suggestion = [
        `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است (آستانه: ۷۵٪).`,
        `برای رسیدن به نسبت سالم ۵۵٪، پیشنهاد می‌شود قیمت پلن‌ها را حدود ${((suggestedMultiplier - 1) * 100).toFixed(0)}٪ افزایش دهید.`,
      ].join(' ');
    } else if (ratio >= 0.6) {
      alertLevel = 'warning';
      suggestion = `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است — نزدیک به آستانه هشدار. مراقب باشید.`;
    }

    return {
      monthlyRevenueToman: monthlyRevenue,
      monthlyAiCostToman: monthlyAiCost, // حالا شامل هزینه‌ی چت + دیسکاوری/کریتیو است
      monthlyChatAiCostToman: monthlyChatAiCost,
      monthlyDiscoveryAiCostToman: monthlyDiscoveryAiCost,
      monthlyAiCostUsd,
      aiCostRatio: Math.round(ratio * 1000) / 10,
      alertLevel,
      suggestion,
    };
  }

  async setManualLimit(userId: string, type: LimitType, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(fa.admin.userNotFound);

    const ttl = LIMIT_TTL[type];
    const expiresAt = Date.now() + ttl * 1000;
    await this.redis.set(
      manualLimitKey(userId),
      JSON.stringify({ type, reason: reason ?? '', expiresAt }),
      'EX',
      ttl,
    );
    return { success: true, expiresAt: new Date(expiresAt).toISOString() };
  }

  async removeManualLimit(userId: string) {
    await this.redis.del(manualLimitKey(userId));
    return { success: true };
  }

  async getManualLimit(userId: string) {
    const raw = await this.redis.get(manualLimitKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as {
      type: LimitType;
      reason: string;
      expiresAt: number;
    };
  }

  async changeUserPlan(userId: string, planId: string) {
    const [user, plan] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.plan.findUnique({ where: { id: planId } }),
    ]);
    if (!user) throw new NotFoundException(fa.admin.userNotFound);
    if (!plan) throw new NotFoundException(fa.plans.notFound);

    const now = new Date();
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
    );

    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, planId, periodStart: now, periodEnd, status: 'ACTIVE' },
      update: {
        planId,
        periodStart: now,
        periodEnd,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      },
    });

    // clear plan cache so next request fetches new plan
    await this.redis.del(`plan:${userId}`);

    return { success: true, subscription: sub };
  }

  // docs/PRD-pay-as-you-go-wallet.md — بازگشت وجه دستی (پول واقعی را خودِ ادمین خارج از این
  // سیستم برمی‌گرداند): موجودی کیف‌پول صفر و به‌عنوان تراکنش ثبت می‌شود، و کاربر از پلن PAYG
  // خارج و به پلن رایگان سوییچ می‌شود — مبلغ دقیق برگردانده‌شده برای انجام واقعی به ادمین نشان داده می‌شود
  async refundAndDeactivatePayg(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(fa.admin.userNotFound);

    const refundedAmountToman = await this.pricingService.refundWallet(
      userId,
      fa.payAsYouGo.adminRefundDescription,
    );

    const freePlan = await this.prisma.plan.findFirst({
      where: { priceMonthly: 0, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (freePlan) await this.changeUserPlan(userId, freePlan.id);

    return { refundedAmountToman, downgradedToFreePlan: Boolean(freePlan) };
  }

  async getRevenueStats() {
    // docs/PRD-admin-credit-reports.md فاز ۲ — قبلاً «revenue» یک عدد کلی از سه چیز متفاوت
    // بود (اشتراک ماهانه، شارژ دستی PAYG قدیمی، خرید بسته‌ی نیوو). حالا با packageId
    // (migration دستی 20260821b) تفکیک خرید بسته‌ی نیوو ممکن شده — creditRevenue/subscriptionRevenue
    // فیلدهای جدید کنار «revenue» کلی قدیمی (که دست‌نخورده می‌ماند) اضافه شده‌اند.
    const rows = await this.prisma.$queryRaw<
      Array<{
        month: string;
        revenue: bigint;
        count: bigint;
        creditRevenue: bigint;
        subscriptionRevenue: bigint;
      }>
    >`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        SUM(amount)::bigint AS revenue,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(amount) FILTER (WHERE "packageId" IS NOT NULL), 0)::bigint AS "creditRevenue",
        COALESCE(SUM(amount) FILTER (WHERE kind = 'SUBSCRIPTION'), 0)::bigint AS "subscriptionRevenue"
      FROM payments
      WHERE status = 'COMPLETED'
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `;

    return rows.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue),
      count: Number(r.count),
      creditRevenue: Number(r.creditRevenue),
      subscriptionRevenue: Number(r.subscriptionRevenue),
    }));
  }

  // ── AI Models ────────────────────────────────────────────────────────────

  getModels() {
    return this.prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  createModel(dto: CreateModelDto) {
    return this.prisma.aiModel.create({ data: dto });
  }

  async updateModel(id: string, dto: UpdateModelDto) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('مدل یافت نشد');
    return this.prisma.aiModel.update({ where: { id }, data: dto });
  }

  async deleteModel(id: string) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('مدل یافت نشد');
    await this.prisma.aiModel.delete({ where: { id } });
    return { message: 'مدل حذف شد' };
  }

  async importModels(buffer: Buffer) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('فایل اکسل قابل خواندن نیست');
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (rows.length === 0) throw new BadRequestException('فایل اکسل خالی است');

    const hasKnownColumn = Object.keys(rows[0]).some((key) =>
      (MODEL_IMPORT_COLUMNS as readonly string[]).includes(key),
    );
    if (!hasKnownColumn) {
      throw new BadRequestException(
        `فرمت ستون‌های فایل اکسل شناخته نشد. ستون‌های مورد انتظار: ${MODEL_IMPORT_COLUMNS.join('، ')}`,
      );
    }

    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // ردیف ۱ هدر است
      const data = parseModelRow(rows[i]);

      const instance = plainToInstance(CreateModelDto, data);
      const violations = await validate(instance);
      if (violations.length > 0) {
        const message = violations
          .map((v) => Object.values(v.constraints ?? {}).join('، '))
          .join(' | ');
        errors.push({ row: rowNumber, message });
        continue;
      }

      try {
        const existing = await this.prisma.aiModel.findUnique({
          where: { name: data.name },
        });
        await this.prisma.aiModel.upsert({
          where: { name: data.name as string },
          create: data as CreateModelDto,
          update: data,
        });
        if (existing) updated++;
        else created++;
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' });
      }
    }

    return { total: rows.length, created, updated, errors };
  }

  // A/B تست مدل‌های AI ایجنت فروش (فیدبک اول پایلوت) — آمار per-variant، یا (بخش ۴
  // PRD-sales-agent-admin-analytics.md) per-channel برای مقایسه‌ی نرخ تبدیل وب/تلگرام
  async getAbStats(params?: {
    storeId?: string;
    from?: Date;
    to?: Date;
    groupBy?: StatsGroupBy;
  }) {
    return computeConversationStats(this.prisma, params);
  }

  // ریپورت پیام‌های نافهم — دو دلیل ممکن روی AGENT_REPLY (docs/PRD-seller-knowledge-base.md
  // بخش ۴): 'UNCLEAR' (NLU کلاً نفهمید) یا 'NO_KB_MATCH' (فهمید ولی باکس دانش جوابی نداشت).
  // فیلتر flag در JS انجام می‌شود (نه JSON path پریزما) — طبق پلن، حجم پایلوت کم است
  async getFailedMessages(params: {
    storeId?: string;
    variant?: string;
    reason?: 'UNCLEAR' | 'NO_KB_MATCH';
    from?: Date;
    to?: Date;
    page?: number;
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = 20;

    const events = await this.prisma.conversationEvent.findMany({
      where: {
        type: 'AGENT_REPLY',
        ...((params.from ?? params.to)
          ? {
              createdAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        conversationId: true,
        payload: true,
        createdAt: true,
      },
    });

    const failed = events.filter((e) => {
      const flag = (e.payload as { flag?: string })?.flag;
      if (flag !== 'UNCLEAR' && flag !== 'NO_KB_MATCH') return false;
      return params.reason ? flag === params.reason : true;
    });
    if (failed.length === 0) return { items: [], total: 0, page };

    const conversationIds = Array.from(
      new Set(failed.map((e) => e.conversationId)),
    );
    const conversations = await this.prisma.salesConversation.findMany({
      where: { id: { in: conversationIds } },
      select: {
        id: true,
        storeId: true,
        abVariant: true,
        store: { select: { name: true } },
      },
    });
    const conversationById = new Map(conversations.map((c) => [c.id, c]));

    let filtered = failed.filter((e) => conversationById.has(e.conversationId));
    if (params.storeId) {
      filtered = filtered.filter(
        (e) =>
          conversationById.get(e.conversationId)?.storeId === params.storeId,
      );
    }
    if (params.variant) {
      filtered = filtered.filter(
        (e) =>
          conversationById.get(e.conversationId)?.abVariant === params.variant,
      );
    }

    const total = filtered.length;
    const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

    const stuckConversationIds = await getStuckConversationIds(
      this.prisma,
      Array.from(new Set(pageItems.map((e) => e.conversationId))),
    );

    const items = await Promise.all(
      pageItems.map(async (e) => {
        const prevCustomerMessage =
          await this.prisma.conversationEvent.findFirst({
            where: {
              conversationId: e.conversationId,
              type: 'CUSTOMER_MESSAGE',
              createdAt: { lt: e.createdAt },
            },
            orderBy: { createdAt: 'desc' },
            select: { payload: true },
          });
        const conv = conversationById.get(e.conversationId);
        return {
          id: e.id,
          conversationId: e.conversationId,
          storeName: conv?.store.name ?? '',
          customerMessage:
            (prevCustomerMessage?.payload as { text?: string })?.text ?? '',
          variant: conv?.abVariant ?? null,
          reason:
            (e.payload as { flag?: 'UNCLEAR' | 'NO_KB_MATCH' })?.flag ??
            'UNCLEAR',
          endedInHandoff: stuckConversationIds.has(e.conversationId),
          createdAt: e.createdAt,
        };
      }),
    );

    return { items, total, page };
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — برخلاف getFailedMessages (فقط پیام‌های نافهم)، این یک لیست
  // عمومی و قابل‌مرور همه‌ی مکالمات است، فیلترپذیر روی فروشگاه/وضعیت/تاریخ. جزئیات کامل هر
  // مکالمه (مسیر/reasoning) عمداً این‌جا decode نمی‌شود — برای همون getConversationTrace موجود
  // (درخواست جدا، فقط وقتی ادمین روی یک ردیف کلیک می‌کند) باقی می‌ماند تا کوئری لیست سبک بماند.
  // حداکثر ۴ کوئری مستقل از اندازه‌ی کل جدول (count، لیست صفحه، آخرین پیام، تعداد failed) —
  // همون الگوی bounded-page-size که getFailedMessages/getBuyerIntentDiscovery دارند.
  async getConversations(params: {
    storeId?: string;
    state?: ConversationState;
    from?: Date;
    to?: Date;
    page?: number;
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = 20;
    const where = {
      ...(params.storeId ? { storeId: params.storeId } : {}),
      ...(params.state ? { currentState: params.state } : {}),
      ...((params.from ?? params.to)
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [total, conversations] = await Promise.all([
      this.prisma.salesConversation.count({ where }),
      this.prisma.salesConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          storeId: true,
          currentState: true,
          abVariant: true,
          createdAt: true,
          updatedAt: true,
          store: { select: { name: true } },
          customer: { select: { fullName: true, phone: true, channel: true } },
        },
      }),
    ]);

    if (conversations.length === 0) return { items: [], total, page };

    const conversationIds = conversations.map((c) => c.id);
    const [lastMessages, agentReplies, stuckConversationIds] =
      await Promise.all([
        this.prisma.conversationEvent.findMany({
          where: {
            conversationId: { in: conversationIds },
            type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY'] },
          },
          orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
          distinct: ['conversationId'],
          select: { conversationId: true, payload: true, createdAt: true },
        }),
        this.prisma.conversationEvent.findMany({
          where: {
            conversationId: { in: conversationIds },
            type: 'AGENT_REPLY',
          },
          select: { conversationId: true, payload: true },
        }),
        getStuckConversationIds(this.prisma, conversationIds),
      ]);

    const lastMessageByConversation = new Map(
      lastMessages.map((e) => [e.conversationId, e]),
    );
    const failedCountByConversation = new Map<string, number>();
    for (const e of agentReplies) {
      const flag = (e.payload as { flag?: string })?.flag;
      if (flag !== 'UNCLEAR' && flag !== 'NO_KB_MATCH') continue;
      failedCountByConversation.set(
        e.conversationId,
        (failedCountByConversation.get(e.conversationId) ?? 0) + 1,
      );
    }

    const items = conversations.map((c) => {
      const lastMessage = lastMessageByConversation.get(c.id);
      const lastMessagePayload = lastMessage?.payload as
        { text?: string } | undefined;
      return {
        id: c.id,
        storeId: c.storeId,
        storeName: c.store.name,
        customerName: c.customer.fullName,
        customerPhone: c.customer.phone,
        channel: c.customer.channel,
        currentState: c.currentState,
        abVariant: c.abVariant,
        lastMessagePreview: lastMessagePayload?.text ?? '',
        lastMessageAt: lastMessage?.createdAt ?? null,
        failedTurnCount: failedCountByConversation.get(c.id) ?? 0,
        endedInHandoff: stuckConversationIds.has(c.id),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });

    return { items, total, page };
  }

  // docs/PRD-admin-ai-decision-trace-log.md بخش ۳ — تایم‌لاین کامل یک مکالمه، CUSTOMER_MESSAGE
  // را با AGENT_REPLY بعدی‌اش و (اگر بود) AI_TRACE بلافاصله بعد از همان AGENT_REPLY جفت می‌کند؛
  // منطق ترکیب اینجاست، فرانت فقط رندر می‌کند
  async getConversationTrace(conversationId: string) {
    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY', 'AI_TRACE'] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, payload: true, createdAt: true },
    });

    const items: {
      id: string;
      createdAt: Date;
      customerMessage?: string;
      agentReply?: {
        text: string;
        flag?: string;
        // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — برخلاف trace (فقط روی پاسخ‌های AI-محور ساخته می‌شود)،
        // این فیلد روی AGENT_REPLY خودش نشسته که همیشه برای هر پاسخی ساخته می‌شود؛ پس
        // برای پاسخ‌های قانون‌محور ثابت (فاکتور/سبد/handoff/...) هم وویس قابل دیدن است
        voice?: { generated: boolean; reason?: string };
      };
      trace?: Record<string, unknown>;
      // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۴.۲ — trace سطح classification
      // (handler:'parseIntent')، به پیام مشتری می‌چسبد نه به پاسخ ربات
      classificationTrace?: Record<string, unknown>;
    }[] = [];

    for (const e of events) {
      if (e.type === 'CUSTOMER_MESSAGE') {
        items.push({
          id: e.id,
          createdAt: e.createdAt,
          customerMessage: (e.payload as { text?: string })?.text ?? '',
        });
      } else if (e.type === 'AGENT_REPLY') {
        items.push({
          id: e.id,
          createdAt: e.createdAt,
          agentReply: e.payload as {
            text: string;
            flag?: string;
            voice?: { generated: boolean; reason?: string };
          },
        });
      } else {
        // AI_TRACE — دو نوع: (۱) handler:'parseIntent'، همیشه بلافاصله بعد از CUSTOMER_MESSAGE
        // خودش ساخته می‌شود (handleMessage)، به آن می‌چسبد؛ (۲) بقیه، همیشه بلافاصله بعد از
        // AGENT_REPLY خودشان ساخته می‌شوند (logReply)، به آن می‌چسبند
        const last = items[items.length - 1];
        const payload = e.payload as Record<string, unknown>;
        if (
          payload?.handler === 'parseIntent' &&
          last?.customerMessage !== undefined
        ) {
          last.classificationTrace = payload;
        } else if (last?.agentReply) {
          last.trace = payload;
        }
      }
    }

    return { items };
  }

  // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵ — گزارش تجمیعی روی همان AI_TRACE هایی که
  // handleMessage (نه logReply) با handler:'parseIntent' می‌نویسد. فیلتر فروشگاه/تاریخ دقیقاً
  // همان الگوی in-memory filter بعد از join به SalesConversation که getFailedMessages دارد،
  // چون payload یک Json آزاد است نه ستون قابل query مستقیم
  async getBuyerIntentDiscovery(params: {
    storeId?: string;
    from?: Date;
    to?: Date;
  }) {
    const events = await this.prisma.conversationEvent.findMany({
      where: {
        type: 'AI_TRACE',
        ...((params.from ?? params.to)
          ? {
              createdAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        conversationId: true,
        payload: true,
        createdAt: true,
      },
    });

    const classificationEvents = events.filter(
      (e) => (e.payload as { handler?: string })?.handler === 'parseIntent',
    );
    if (classificationEvents.length === 0) {
      return { buyerNeedCounts: [], unmatched: [], lowConfidence: [] };
    }

    const conversationIds = Array.from(
      new Set(classificationEvents.map((e) => e.conversationId)),
    );
    const conversations = await this.prisma.salesConversation.findMany({
      where: { id: { in: conversationIds } },
      select: { id: true, storeId: true, store: { select: { name: true } } },
    });
    const storeIdByConversation = new Map(
      conversations.map((c) => [c.id, c.storeId]),
    );
    const storeNameByConversation = new Map(
      conversations.map((c) => [c.id, c.store.name]),
    );

    const filtered = params.storeId
      ? classificationEvents.filter(
          (e) => storeIdByConversation.get(e.conversationId) === params.storeId,
        )
      : classificationEvents;

    const buyerNeedCountMap = new Map<string, number>();
    // گروه‌بندی ساده‌ی متن‌محور (طبق PRD بخش ۵.۳ — خوشه‌بندی هوشمندتر عمداً فاز بعد است)
    const unmatchedGroups = new Map<
      string,
      {
        count: number;
        conversationId: string;
        createdAt: Date;
        nearestIntent: string;
      }
    >();
    // «Potential misclassification» بخش ۵.۱ — بر خلاف unmatched، این‌ها گروه‌بندی نمی‌شوند
    // (هر رخداد جدا قابل‌بررسی است، نه یک برچسب تکراری)؛ فقط ۵۰ مورد اخیر (بدون صفحه‌بندی کامل،
    // چون حجم این گزارش عمداً کوچک نگه داشته شده)
    const lowConfidenceRaw: {
      conversationId: string;
      intent: string;
      confidence: 'MEDIUM' | 'LOW';
      createdAt: Date;
    }[] = [];

    for (const e of filtered) {
      const payload = e.payload as {
        buyerNeeds?: string[];
        unmatchedBuyerNeed?: string;
        intentConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
        intent?: string;
      };
      for (const tag of payload.buyerNeeds ?? []) {
        buyerNeedCountMap.set(tag, (buyerNeedCountMap.get(tag) ?? 0) + 1);
      }
      if (payload.intentConfidence && payload.intentConfidence !== 'HIGH') {
        lowConfidenceRaw.push({
          conversationId: e.conversationId,
          intent: payload.intent ?? '',
          confidence: payload.intentConfidence,
          createdAt: e.createdAt,
        });
      }
      const label = payload.unmatchedBuyerNeed?.trim();
      if (!label) continue;
      const existing = unmatchedGroups.get(label);
      if (existing) {
        existing.count += 1;
        if (e.createdAt > existing.createdAt) {
          existing.conversationId = e.conversationId;
          existing.createdAt = e.createdAt;
          existing.nearestIntent = payload.intent ?? '';
        }
      } else {
        unmatchedGroups.set(label, {
          count: 1,
          conversationId: e.conversationId,
          createdAt: e.createdAt,
          nearestIntent: payload.intent ?? '',
        });
      }
    }

    const lowConfidenceTop = lowConfidenceRaw
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
    const lowConfidenceSamples = await Promise.all(
      lowConfidenceTop.map((item) =>
        this.prisma.conversationEvent.findFirst({
          where: {
            conversationId: item.conversationId,
            type: 'CUSTOMER_MESSAGE',
            createdAt: { lte: item.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { payload: true },
        }),
      ),
    );
    const lowConfidence = lowConfidenceTop.map((item, i) => ({
      conversationId: item.conversationId,
      storeName: storeNameByConversation.get(item.conversationId) ?? '',
      intent: item.intent,
      confidence: item.confidence,
      sampleMessage:
        (lowConfidenceSamples[i]?.payload as { text?: string })?.text ?? '',
      createdAt: item.createdAt,
    }));

    // نمونه پیام مشتری برای هر گروه نامشخص — همان پیامی که این classification را تولید کرد
    // (بلافاصله قبل از همین AI_TRACE در همان مکالمه، طبق ترتیب نوشتن در handleMessage)
    const unmatchedEntries = Array.from(unmatchedGroups.entries());
    const sampleMessages = await Promise.all(
      unmatchedEntries.map(([, g]) =>
        this.prisma.conversationEvent.findFirst({
          where: {
            conversationId: g.conversationId,
            type: 'CUSTOMER_MESSAGE',
            createdAt: { lte: g.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { payload: true },
        }),
      ),
    );

    const unmatched = unmatchedEntries
      .map(([label, g], i) => ({
        label,
        count: g.count,
        conversationId: g.conversationId,
        storeName: storeNameByConversation.get(g.conversationId) ?? '',
        sampleMessage:
          (sampleMessages[i]?.payload as { text?: string })?.text ?? '',
        lastSeenAt: g.createdAt,
        // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵.۲ — «نزدیک‌ترین intent موجود»: همان
        // intent اجرایی تک‌برچسبی که در همان AI_TRACE کنار این unmatchedBuyerNeed کلاسیفای شده
        // بود (نه یک محاسبه‌ی شباهت جدا — طبق بخش ۵.۳، خوشه‌بندی هوشمند عمداً خارج از این فاز است)
        nearestIntent: g.nearestIntent,
      }))
      .sort((a, b) => b.count - a.count);

    const buyerNeedCounts = Array.from(buyerNeedCountMap.entries())
      .map(([tag, count]) => ({
        tag,
        count,
        journeyStage: buyerNeedJourneyStage(tag),
      }))
      .sort((a, b) => b.count - a.count);

    return { buyerNeedCounts, unmatched, lowConfidence };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ — نرخ جواب‌دهی + نسبت
  // POSITIVE/NEGATIVE/UNRELATED فالوآپ رضایت. مبنا: هر Order که satisfactionFollowUpSentAt دارد
  // یعنی فالوآپ فرستاده شده؛ «جواب» یعنی یک AI_TRACE با handler:'satisfactionClassify' که بعد از
  // همان لحظه برای همان مکالمه ثبت شده (conversation-engine.service.ts's doSatisfactionReply)
  async getFollowUpInstrumentation(params: {
    storeId?: string;
    from?: Date;
    to?: Date;
  }) {
    const orders = await this.prisma.order.findMany({
      where: {
        satisfactionFollowUpSentAt: { not: null },
        ...(params.storeId ? { storeId: params.storeId } : {}),
        ...((params.from ?? params.to)
          ? {
              satisfactionFollowUpSentAt: {
                not: null,
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      select: { conversationId: true, satisfactionFollowUpSentAt: true },
    });
    if (orders.length === 0) {
      return {
        sentCount: 0,
        respondedCount: 0,
        responseRate: 0,
        verdictCounts: { POSITIVE: 0, NEGATIVE: 0, UNRELATED: 0 },
      };
    }

    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId: { in: orders.map((o) => o.conversationId) },
        type: 'AI_TRACE',
      },
      orderBy: { createdAt: 'asc' },
      select: { conversationId: true, payload: true, createdAt: true },
    });
    const classifyEventsByConversation = new Map<
      string,
      { verdict: string; createdAt: Date }[]
    >();
    for (const e of events) {
      const payload = e.payload as { handler?: string; verdict?: string };
      if (payload.handler !== 'satisfactionClassify' || !payload.verdict) {
        continue;
      }
      const list = classifyEventsByConversation.get(e.conversationId) ?? [];
      list.push({ verdict: payload.verdict, createdAt: e.createdAt });
      classifyEventsByConversation.set(e.conversationId, list);
    }

    const verdictCounts = { POSITIVE: 0, NEGATIVE: 0, UNRELATED: 0 };
    let respondedCount = 0;
    for (const order of orders) {
      const candidates = (
        classifyEventsByConversation.get(order.conversationId) ?? []
      ).filter((e) => e.createdAt >= order.satisfactionFollowUpSentAt!);
      if (candidates.length === 0) continue;
      respondedCount++;
      const verdict = candidates[0].verdict as keyof typeof verdictCounts;
      if (verdict in verdictCounts) verdictCounts[verdict]++;
    }

    return {
      sentCount: orders.length,
      respondedCount,
      responseRate: respondedCount / orders.length,
      verdictCounts,
    };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ — نرخ بازیابی سبد رهاشده. رابطه‌ی
  // Order/SalesConversation یک‌به‌یک است (Order.conversationId @unique)، و چون این سرویس فقط
  // یک‌بار برای هر مکالمه فیر می‌شود (abandonedCartReminderSentAt: null بودن شرط کوئری است)، هر
  // سفارش APPROVED روی این مکالمه قطعاً نتیجه‌ی بعد از یادآوری است
  async getCartRecoveryInstrumentation(params: {
    storeId?: string;
    from?: Date;
    to?: Date;
  }) {
    const conversations = await this.prisma.salesConversation.findMany({
      where: {
        abandonedCartReminderSentAt: { not: null },
        ...(params.storeId ? { storeId: params.storeId } : {}),
        ...((params.from ?? params.to)
          ? {
              abandonedCartReminderSentAt: {
                not: null,
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    if (conversations.length === 0) {
      return { remindersSent: 0, recoveredCount: 0, recoveryRate: 0 };
    }

    const recoveredCount = await this.prisma.order.count({
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        status: 'APPROVED',
      },
    });

    return {
      remindersSent: conversations.length,
      recoveredCount,
      recoveryRate: recoveredCount / conversations.length,
    };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ + PRD-seller-advertising-placements.md
  // بخش ۵ — طبق تصمیم خودِ سند تبلیغات، فقط «نشان داده شد یا نه» لازم است، نه نرخ کلیک
  async getAdPlacementInstrumentation(params: { storeId?: string }) {
    const placements = await this.prisma.adPlacement.findMany({
      where: params.storeId ? { storeId: params.storeId } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        storeId: true,
        store: { select: { name: true } },
        placement: true,
        status: true,
        startsAt: true,
        endsAt: true,
        impressionCount: true,
      },
    });
    return {
      items: placements.map((p) => ({
        id: p.id,
        storeId: p.storeId,
        storeName: p.store.name,
        placement: p.placement,
        status: p.status,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        impressionCount: p.impressionCount,
      })),
      totalImpressions: placements.reduce(
        (sum, p) => sum + p.impressionCount,
        0,
      ),
    };
  }

  // ── تنظیمات مارکت‌پلیس sales-agent (SalesAgentGlobalConfig singleton) ───────────────────
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۵ — سهمیه‌ی رایگان روزانه +
  // دوره‌ی آزمایشی؛ جدا از CreditConfig (ویجت نیوو/nivoai.ir)
  getSalesAgentGlobalConfigAdmin() {
    return getSalesAgentGlobalConfig(this.prisma);
  }

  async updateSalesAgentGlobalConfig(dto: UpdateSalesAgentGlobalConfigDto) {
    const config = await this.prisma.salesAgentGlobalConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...dto },
      update: dto,
    });
    invalidateSalesAgentGlobalConfigCache();
    return config;
  }
}
