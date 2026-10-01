import { IsIn } from 'class-validator';

// docs/PRD-sales-agent-response-strategy-ab.md بخش ۹ — سوییچ دستی خریدار برای تست زنده‌ی
// Track A (RULE_BASED) در برابر Track B (SIMPLE_AGENT) روی همون مکالمه؛ جدا از پیک تصادفی
// pickResponseStrategy که فقط موقع ساخت مکالمه اجرا می‌شود
export class SetResponseStrategyDto {
  @IsIn(['RULE_BASED', 'SIMPLE_AGENT'])
  responseStrategy: 'RULE_BASED' | 'SIMPLE_AGENT';
}
