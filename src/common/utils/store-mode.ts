// «فروشگاه لید نیوو» = صفحه‌ی ثبت‌نام خودِ نیوو (LS-1..LS-3). فلگ leadCaptureOnly در کپی‌های
// دمو هم true بود (معنای قدیمی: «Order واقعی نمی‌سازد»)، پس برای معنای جدید باید isDemo را هم دید.
export function isNivoLeadStore(store: { leadCaptureOnly?: boolean | null; isDemo?: boolean | null }): boolean {
  return store.leadCaptureOnly === true && store.isDemo !== true;
}

// DEMO-2 — کارت ساختگی فروشگاه دمو؛ شماره‌ی واقعی قالب هرگز به خریدار دمو نشان داده نمی‌شود
export const DEMO_FAKE_CARD_NUMBER = '0000000000000000';
export const DEMO_FAKE_CARD_OWNER = 'کارت نمونه — واریز نکن';
