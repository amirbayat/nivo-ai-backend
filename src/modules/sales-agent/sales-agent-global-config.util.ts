import type { PrismaService } from '../../prisma/prisma.service';
import type { SalesAgentGlobalConfig } from '@prisma/client';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۴ — خوانده‌شده در هر چت تازه،
// پس باید کش شود (همون الگوی ۶۰ ثانیه‌ی StoreKbService). تابع ساده (نه یک NestJS service) تا
// هم modules/sales-agent هم modules/store (StoreCreditService) بتوانند بدون import چرخه‌ای
// صدایش بزنند — SalesAgentModule خودش StoreModule را import می‌کند، برعکسش ممکن نیست.
const CACHE_TTL_MS = 60_000;
let cached: { config: SalesAgentGlobalConfig; cachedAt: number } | null = null;

export async function getSalesAgentGlobalConfig(
  prisma: PrismaService,
): Promise<SalesAgentGlobalConfig> {
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.config;
  const config = await prisma.salesAgentGlobalConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  cached = { config, cachedAt: now };
  return config;
}

// بعد از ذخیره‌ی تنظیمات از پنل ادمین صدا زده می‌شود تا تغییر بدون صبر برای انقضای TTL اثر کند
export function invalidateSalesAgentGlobalConfigCache(): void {
  cached = null;
}
