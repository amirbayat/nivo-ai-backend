// اینترفیس مشترک هر provider ویدیو (Kie/Veo/Runway) — طبق پلن بخش ۳.۶. KieProviderService و
// OpenRouterVideoProviderService از قبل همین شکل را (با نام متد کمی متفاوت) دارند؛ این فایل
// فقط برای دو provider تازه (Veo/Runway) صراحتاً استفاده می‌شود، چون این دو به‌جای
// jobs/createTask عمومی، endpoint اختصاصی خودشان را دارند (تایید‌شده از docs.kie.ai:
// /api/v1/veo/generate+record-info، /api/v1/runway/generate+record-detail).
export type VideoProviderState =
  | 'waiting'
  | 'queuing'
  | 'generating'
  | 'success'
  | 'fail';

export interface VideoProviderClient {
  submit(
    modelSlug: string,
    input: Record<string, unknown>,
  ): Promise<{ taskId: string }>;
  poll(taskId: string): Promise<{
    state: VideoProviderState;
    resultUrls: string[];
    failMsg?: string | null;
  }>;
  downloadResult(url: string): Promise<Buffer>;
}
