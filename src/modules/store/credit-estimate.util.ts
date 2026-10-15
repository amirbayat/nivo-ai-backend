// R3.4 — «حدود N گفتگو باقی‌مانده»؛ فقط وقتی نمونه‌ی ۳۰ روز اخیر به‌اندازه‌ی کافی بزرگ است
export const MIN_CONVERSATIONS_FOR_ESTIMATE = 20;

export function estimateConversationsLeft(
  balanceToman: number,
  chargedLast30dToman: number,
  conversationsLast30d: number,
): number | null {
  if (conversationsLast30d < MIN_CONVERSATIONS_FOR_ESTIMATE) return null;
  const avg = chargedLast30dToman / conversationsLast30d;
  if (!(avg > 0)) return null;
  return Math.max(0, Math.floor(balanceToman / avg));
}
