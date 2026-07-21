// مقادیر مجاز reasoning effort — برای Plan.reasoningEffort (پیش‌فرض پلن)،
// PlanRoutingStep.reasoningEffort (override به‌ازای استپ بودجه‌ای)، و Plan.fastReasoningEffort/
// smartReasoningEffort (دراپ‌دون «سریع/هوشمند» کنار ارسال پیام). زیرمجموعه‌ی محدودتری از کل
// union پذیرفته‌شده توسط AI SDK ('provider-default'|'none'|...|'xhigh') — همان سطوحی که برای
// کنترل ادمین معنادارند؛ 'none' («بدون فکر») مخصوصاً برای حالت «سریع» لازم است.
export const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number]
