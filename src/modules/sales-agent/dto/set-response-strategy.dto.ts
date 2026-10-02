import { IsIn } from 'class-validator';

// docs/PRD-sales-agent-response-strategy-ab.md بخش ۹ — سوییچ دستی خریدار برای تست زنده‌ی
// Track A (RULE_BASED) در برابر Track B (SIMPLE_AGENT) روی همون مکالمه؛ جدا از پیک تصادفی
// pickResponseStrategy که فقط موقع ساخت مکالمه اجرا می‌شود
// docs/PRD-sales-agent-tool-calling-architecture.md بخش ۷ (فاز ۳) — FULL_AGENT هم به همین
// سوییچ دستی اضافه شد تا تست زنده‌ی کاربر روی مکالمه‌ی واقعی نیاز به زیرساخت جدا نداشته باشد
export class SetResponseStrategyDto {
  @IsIn(['RULE_BASED', 'SIMPLE_AGENT', 'FULL_AGENT'])
  responseStrategy: 'RULE_BASED' | 'SIMPLE_AGENT' | 'FULL_AGENT';
}
