// «فروشگاه لید نیوو» = صفحه‌ی ثبت‌نام خودِ نیوو (LS-1..LS-3). فلگ leadCaptureOnly در کپی‌های
// دمو هم true بود (معنای قدیمی: «Order واقعی نمی‌سازد»)، پس برای معنای جدید باید isDemo را هم دید.
export function isNivoLeadStore(store: { leadCaptureOnly?: boolean | null; isDemo?: boolean | null }): boolean {
  return store.leadCaptureOnly === true && store.isDemo !== true;
}
