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
  {
    date: '1405/07/25', item: 'ACE-16 (برگه‌ی محصول)', commit: '(ace(ACE-16))', tag: 'ace/ACE-16/start..done',
    sql: '20261058_ace16_product_brief.sql',
    change: 'برای هر محصول با توضیح بلند، در پس‌زمینه برگه (واقعیت‌ها/قیدها/دستورهای فروشنده، بخش‌بندی کلمه‌به‌کلمه) ساخته می‌شود. با layers.productBrief=on در خط facts به‌جای توضیح بریده‌شده می‌آید و ابزار read_product_section اضافه می‌شود',
    answerImpact: 'ساخت برگه روی جواب اثر ندارد. مصرف (on) محتوای prompt و ابزارها را عوض می‌کند؛ فقط موتور بهینه',
    layerKey: 'productBrief',
    rollback: 'layers.productBrief=off در پنل؛ کامل: git revert، سپس rollback/20261058_ace16_product_brief.down.sql',
  },
  {
    date: '1405/07/25', item: 'ACE-12 (shadow و judge)', commit: '(ace(ACE-12))', tag: 'ace/ACE-12/start..done',
    sql: 'none',
    change: 'ذخیره‌ی نمونه‌های shadow در Redis (۳۰ روز)، judge سبک (حداکثر ۲۰۰ در روز، هر ۶ ساعت)، گزارش لایه‌بندی‌شده با دروازه‌ها و صف بازبینی انسانی در تب shadow',
    answerImpact: 'ندارد؛ فقط ثبت و داوری. هیچ جوابی از کاندید ارسال نمی‌شود',
    layerKey: null,
    rollback: 'git revert؛ کلید Redis با پیشوند ace:shadow: قابل حذف',
  },
  {
    date: '1405/07/25', item: 'ACE-10 (جواب قطعی)', commit: '(ace(ACE-10))', tag: 'ace/ACE-10/start',
    sql: 'none',
    change: 'با layers.fastAnswers=shadow برای ASK_PRICE و STOCK_CHECK تک‌محصولی، جواب ترکیبی (قیمت زنده + پیچ برگه‌ی محصول) ساخته و برای judge ثبت می‌شود',
    answerImpact: 'با on: سؤال قیمت/موجودی یک محصول با نام صریح بدون LLM جواب داده می‌شود (قیمت زنده + مزیت از برگه)؛ بدون برگه یا سؤال دوم قیمت → مدل',
    layerKey: 'fastAnswers',
    rollback: 'layers.fastAnswers=off در پنل؛ کامل: git revert',
  },
  {
    date: '1405/07/26', item: 'ACE-11 (کش جواب سؤال تکراری)', commit: '(ace(ACE-11))', tag: 'ace/ACE-11/done',
    sql: 'none',
    change: 'با layers.semanticCache=on، جواب سؤال سیاستی (مرجوعی/ارسال/پرداخت در محل) که بار دوم عیناً تکرار شود تا ۶۰ دقیقه از کش می‌آید؛ فقط جواب بدون عدد/قیمت/موجودی، سبد خالی، state مرور',
    answerImpact: 'متن جواب همان جواب قبلی مدل است؛ با تغییر فروشگاه/KB باطل می‌شود. باند شباهت (cosine) هنوز نیست',
    layerKey: 'semanticCache',
    rollback: 'layers.semanticCache=off در پنل؛ کامل: git revert',
  },
  {
    date: '1405/07/26', item: 'ACE-7 (پیام تکراری)', commit: '(ace(ACE-7))', tag: 'ace/ACE-7/done',
    sql: 'none',
    change: 'با layers.dedupe=on، همان پیام در ۳۰ ثانیه بدون پیام دیگر بین‌شان، همان جواب قبلی را بدون LLM می‌گیرد (فقط اگر جواب قبلی کارت محصول/بدون کارت بوده)',
    answerImpact: 'جواب تکراری عیناً همان قبلی است؛ جهش سبد/سفارش هرگز تکرار نمی‌شود. off-topic هنوز نیست',
    layerKey: 'dedupe',
    rollback: 'layers.dedupe=off در پنل؛ کامل: git revert',
  },
];
