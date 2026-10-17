// بخش ۱۱ سند: دفتر تغییرات رفتار بات. هر کامیتی که چیزی در مسیر بات عوض می‌کند همین‌جا و در سند ردیف اضافه می‌کند.
export interface BotChangelogEntry {
  date: string;
  item: string;
  commit: string;
  tag: string;
  sql: string;
  change: string;
  answerImpact: string;
  layerKey: string | null;
  rollback: string;
}

export const BOT_CHANGELOG: BotChangelogEntry[] = [
  {
    date: '1405/07/24', item: 'ACE-0', commit: 'a3602e5', tag: '—',
    sql: '20261055_ai_call_ledger.sql / rollback/20261055_ai_call_ledger.down.sql',
    change: 'ثبت مصرف هر فراخوانی AI در ai_call_ledger؛ fetch مدل از meter رد می‌شود',
    answerImpact: 'ندارد (فقط ثبت)', layerKey: 'ledger',
    rollback: 'layers.ledger=off در پنل (meter کاملاً دور زده می‌شود)؛ کامل: revert کامیت',
  },
  {
    date: '1405/07/24', item: 'ACE-3، ACE-4', commit: '102fba3', tag: '—',
    sql: '20261056_ai_cost_engine_config.sql / rollback/20261056_ai_cost_engine_config.down.sql',
    change: 'کش memo + single-flight برای faq_pick، کش embedding برای KB',
    answerImpact: 'ندارد تا وقتی کلید روشن نشود', layerKey: 'memo',
    rollback: 'کلید off در پنل',
  },
  {
    date: '1405/07/25', item: 'دو موتور پایدار/بهینه', commit: '—', tag: 'bot-baseline-1405-07-25',
    sql: 'none (داخل JSON جدول config)',
    change: 'engineMode، storeOverrides، audit، برگرداندن فوری، sticky هر گفتگو',
    answerImpact: 'ندارد (پیش‌فرض stable)', layerKey: null,
    rollback: 'دکمه‌ی «برگرداندن فوری به پایدار»؛ آخرین راه: deploy تگ bot-baseline-1405-07-25',
  },
  {
    date: '1405/07/25', item: 'ACE-2', commit: '(ace(ACE-2) پرامپت)', tag: '—',
    sql: 'none',
    change: 'buildFullAgentSystemPromptLean: بلوک‌بندی prompt (قانون ثابت | فروشگاه | کاتالوگ | پویا) + cache_control برای anthropic/* + session_id',
    answerImpact: 'ترتیب prompt عوض می‌شود (قانون‌ها قبل از داده‌ی پویا)؛ فقط موتور بهینه',
    layerKey: 'promptCache',
    rollback: 'layers.promptCache=off در پنل؛ کامل: git revert کامیت ACE-2',
  },
  {
    date: '1405/07/25', item: 'ACE-6 (بودجه‌ی step)', commit: '(ace(ACE-6))', tag: 'ace/ACE-6/start..done',
    sql: 'none',
    change: 'prepareStep: از step چهارم یا ابزار تکراری با ورودی یکسان، respond_to_customer اجباری می‌شود',
    answerImpact: 'نوبت‌های طولانی زودتر جمع می‌شوند؛ فقط موتور بهینه',
    layerKey: 'loopDiet',
    rollback: 'layers.loopDiet=off در پنل؛ کامل: git revert',
  },
  {
    date: '1405/07/25', item: 'ACE-5 (زیرفراخوانی‌ها)', commit: '(ace(ACE-5))', tag: 'ace/ACE-5/start..done',
    sql: 'none',
    change: 'faq_pick، faq_desc، faq_profile و طبقه‌بندی رضایت با مدل سبک (PERCEPTION_MODEL)؛ خطا → زنجیره‌ی fallback قبلی',
    answerImpact: 'جواب سؤال‌های KB/پروفایل ممکن است با مدل سبک‌تر نوشته شود؛ فقط موتور بهینه',
    layerKey: 'subcallDiet',
    rollback: 'layers.subcallDiet=off در پنل؛ کامل: git revert',
  },
  {
    date: '1405/07/25', item: 'ACE-8 (کش وویس)', commit: '(ace(ACE-8))', tag: 'ace/ACE-8/start..done',
    sql: 'none',
    change: 'کش وویس: متن/صدا/مدل/فروشگاه یکسان → همان فایل mp3 (۷ روز)، بدون هزینه‌ی kie.ai',
    answerImpact: 'ندارد (همان صدا)؛ روی hit کسر اعتبار وویس ثبت نمی‌شود (تصمیم ACE-14)',
    layerKey: 'ttsCache',
    rollback: 'layers.ttsCache=off در پنل؛ کامل: git revert',
  },
];
