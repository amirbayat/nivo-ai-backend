// مسیر webhook دریافت callback از Kie (Veo/Runway) — یک‌جا تعریف شده تا مسیری که
// video-edit.processor.ts هنگام submit به Kie می‌دهد (callBackUrl) دقیقاً همان مسیری باشد که
// VideoEditWebhookController گوش می‌دهد؛ هر تغییر در این رشته باید هر دو طرف را با هم عوض کند.
export const KIE_WEBHOOK_ROUTE = 'webhook/kie'; // زیرمسیر کنترلر video-edit (بدون گارد JWT)

export function buildKieWebhookCallbackUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, '')}/api/v1/video-edit/${KIE_WEBHOOK_ROUTE}`;
}
