// فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — همون الگوی video-edit/kie-webhook.constants.ts: مسیری که
// sales-agent-voice.processor.ts هنگام createTask به‌عنوان callBackUrl می‌دهد، باید دقیقاً
// همینی باشد که SalesAgentVoiceWebhookController گوش می‌دهد؛ هر تغییر باید هر دو طرف را با هم عوض کند.
export const SALES_AGENT_VOICE_WEBHOOK_ROUTE = 'webhook/kie'; // زیرمسیر کنترلر sales-agent-voice (بدون گارد JWT)

export function buildSalesAgentVoiceWebhookCallbackUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, '')}/api/v1/sales-agent-voice/${SALES_AGENT_VOICE_WEBHOOK_ROUTE}`;
}
