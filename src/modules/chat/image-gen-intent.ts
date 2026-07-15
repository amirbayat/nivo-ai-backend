// docs/PRD-chat-images.md — تشخیص خودکار نیت «تولید عکس» وسط یک پیام چت معمولی (بدون
// toggle صریح کاربر در فرانت). عمداً فقط heuristic کلیدواژه‌ای است، بدون تماس LLM جدا —
// یک تماس طبقه‌بندی اضافه روی *هر* پیام (که اکثرشان ربطی به عکس ندارند) هزینه/تأخیر بی‌مورد
// به کل چت اضافه می‌کرد. یعنی عمداً فرمول‌بندی‌های خلاقانه/غیرمستقیم را از دست می‌دهد؛ اگر
// false-positive/negative زیاد شد، از ادمین (ChatConfig.implicitImageGenEnabled) خاموش می‌شود.
const IMAGE_NOUNS = ['عکس', 'تصویر', 'نقاشی', 'لوگو', 'طرح گرافیکی']
const GEN_VERBS = ['بکش', 'بساز', 'بسازی', 'تولید کن', 'طراحی کن', 'درست کن', 'رسم کن']

const nounPattern = IMAGE_NOUNS.join('|')
const verbPattern = GEN_VERBS.join('|')

// یا اسم قبل از فعل («یک عکس از گربه بکش») یا فعل قبل از اسم («بساز یه عکس از گربه») —
// حداکثر ۲۰ کاراکتر فاصله تا جمله‌های نامرتبط با هم قاطی نشوند
const IMAGE_GEN_INTENT_RE = new RegExp(
  `(${nounPattern})[^.!؟\\n]{0,20}(${verbPattern})|(${verbPattern})[^.!؟\\n]{0,20}(${nounPattern})`,
)

export function detectImageGenIntent(content: string): boolean {
  return IMAGE_GEN_INTENT_RE.test(content)
}

// وقتی کاربر از قبل عکس فرستاده، دیگر نیازی به اسم «عکس/تصویر» نیست (چون خودِ عکس ضمیمه‌شده
// موضوع را مشخص می‌کند — «سفیدش کن» یعنی «این عکس رو سفید کن») — پس فقط دنبال فعل‌های ویرایش
// می‌گردیم، نه ترکیب اسم+فعل مثل تولید از صفر
const EDIT_VERBS = [
  'ویرایش', 'تغییرش', 'تغییر بده', 'عوضش', 'عوض کن', 'سفیدش', 'سفید کن',
  'رنگش', 'رنگی‌اش', 'روشن‌تر', 'تیره‌تر', 'پاکش', 'پاک کن', 'حذفش', 'حذف کن',
  'اضافه کن', 'درستش کن', 'بهترش کن', 'ریتاچ', 'کراپ', 'برش بده', 'ترکیبشون',
  'ترکیب کن', 'بکش روش', 'بذار روش',
]
const IMAGE_EDIT_INTENT_RE = new RegExp(EDIT_VERBS.join('|'))

export function detectImageEditIntent(content: string): boolean {
  return IMAGE_EDIT_INTENT_RE.test(content)
}
