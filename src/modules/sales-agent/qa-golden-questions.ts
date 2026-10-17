// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۵ — ست ثابت سؤال‌های طلایی؛ قبل از
// فعال‌کردن هر مدل/پرامپت جدید در A/B، این‌ها خودکار روی یک فروشگاه واقعی اجرا می‌شوند تا
// ادمین سریع پاسخ‌ها را کنار هم ببیند (بازبینی انسانی، نه قضاوت خودکار). ویرایش این لیست فقط
// یعنی اضافه/کم‌کردن یک آیتم اینجا — بدون هیچ زیرساخت جدا.
export interface GoldenQuestion {
  id: string;
  category: string;
  question: string;
  // docs/DESIGN-structured-product-search-for-chat-agent.md §۸.۳ — آرگومان مورد انتظار
  // search_products برای سوال‌های رتبه‌ای؛ QA ادمین آرگومان واقعی ابزار را کنار آن نشان می‌دهد
  // (بازبینی انسانی، نه قضاوت خودکار). followUpOf = سوال پیگیری بعد از آن سوال
  expectSpec?: Record<string, unknown>;
  followUpOf?: string;
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  { id: 'g1', category: 'محصول', question: 'این محصول رنگ‌های دیگه هم داره؟' },
  { id: 'g2', category: 'محصول', question: 'قیمتش چقدره؟' },
  { id: 'g3', category: 'محصول', question: 'موجوده الان؟' },
  { id: 'g4', category: 'ارسال', question: 'هزینه ارسال چقدره؟' },
  { id: 'g5', category: 'ارسال', question: 'کی می‌رسه دستم؟' },
  { id: 'g6', category: 'مرجوعی', question: 'اگه سایزش نخورد می‌تونم پس بدم؟' },
  { id: 'g7', category: 'مرجوعی', question: 'گارانتی داره؟' },
  { id: 'g8', category: 'پرداخت', question: 'چطوری پول رو واریز کنم؟' },
  { id: 'g9', category: 'پرداخت', question: 'اقساطی هم میشه خرید؟' },
  { id: 'g10', category: 'اعتماد', question: 'مطمئنم جنس واقعی میفرستید؟' },
  {
    id: 'g11',
    category: 'اعتماد',
    question: 'شما اصالتاً از کجایید؟ چند ساله فعالید؟',
  },
  { id: 'g12', category: 'چانه‌زنی', question: 'تخفیف نمیدی؟ گرون‌ه' },
  { id: 'g13', category: 'چانه‌زنی', question: 'یکم ارزون‌تر بده لطفاً' },
  { id: 'g14', category: 'خارج از دامنه', question: 'میتونی برام شعر بگی؟' },
  { id: 'g15', category: 'خارج از دامنه', question: 'نظرت راجب سیاست چیه؟' },
  { id: 'g16', category: 'مبهم', question: 'اون یکی رو میخوام' },
  { id: 'g17', category: 'مبهم', question: 'چیزی که گفتی رو نمی‌فهمم' },
  { id: 'g18', category: 'سفارش', question: 'سفارشم کجاست؟' },
  { id: 'g19', category: 'سفارش', question: 'میخوام سفارشمو کنسل کنم' },
  {
    id: 'g20',
    category: 'عمومی',
    question: 'سلام، چیکار می‌تونید برام بکنید؟',
  },
  // سوال‌های رتبه‌ای/محدوده‌ای — جست‌وجوی ساختاریافته روی کل کاتالوگ
  { id: 'g21', category: 'رتبه‌ای', question: 'ارزون‌ترین چیزی که دارید چیه؟', expectSpec: { sortBy: 'price' } },
  {
    id: 'g22',
    category: 'رتبه‌ای',
    question: 'زیر ۲ گرم با اجرت کمتر از ۱۰ درصد دارید؟',
    expectSpec: { maxWeightGrams: 2, maxWagePercent: 10, sortBy: 'wage' },
  },
  { id: 'g23', category: 'رتبه‌ای', question: 'سبک‌ترین انگشترتون کدومه؟', expectSpec: { query: 'انگشتر', sortBy: 'weight' } },
  {
    id: 'g24',
    category: 'رتبه‌ای',
    question: 'مشکی سایز ۴۲ زیر ۳ میلیون دارید؟',
    expectSpec: { attributes: [{ name: 'رنگ', value: 'مشکی' }, { name: 'سایز', value: '42' }], maxPrice: 3000000 },
  },
  { id: 'g25', category: 'رتبه‌ای', question: 'یه کار گرم پایین‌تر ندارید؟', followUpOf: 'g22', expectSpec: { sortBy: 'weight', nextPage: true } },
  { id: 'g26', category: 'رتبه‌ای', question: 'بودجم ۳ میلیون تومنه', expectSpec: { maxPrice: 3000000 } },
];
