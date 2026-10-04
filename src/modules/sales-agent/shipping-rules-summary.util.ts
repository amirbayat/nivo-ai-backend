import { PrismaService } from '../../prisma/prisma.service';

// bugs.md آیتم ۲۴ — خلاصه‌ی متنی StoreShippingRule (هزینه به‌تفکیک استان) برای تزریق به
// context/facts پاسخ‌دهی FAQ؛ قبل از این، فقط Store.shippingInfo (متن آزاد) دیده می‌شد و
// فروشنده‌هایی که فقط از صفحه‌ی ساخت‌یافته‌ی «هزینه ارسال» استفاده می‌کردند جواب نمی‌گرفتند
export async function formatShippingRulesSummary(
  prisma: PrismaService,
  storeId: string,
): Promise<string | null> {
  const rules = await prisma.storeShippingRule.findMany({ where: { storeId } });
  if (rules.length === 0) return null;

  const specific = rules.filter((r) => r.provinces.length > 0);
  const defaultRule = rules.find((r) => r.provinces.length === 0);

  const lines: string[] = [];
  for (const r of specific) {
    const provinceList = r.provinces.join('، ');
    lines.push(
      r.enabled
        ? `ارسال به ${provinceList}: ${r.cost.toLocaleString('fa-IR')} تومان`
        : `به ${provinceList} ارسال نداریم`,
    );
  }
  if (defaultRule) {
    lines.push(
      defaultRule.enabled
        ? `سایر استان‌ها: ${defaultRule.cost.toLocaleString('fa-IR')} تومان`
        : 'به سایر استان‌ها ارسال نداریم',
    );
  }

  return lines.length ? lines.join('\n') : null;
}
