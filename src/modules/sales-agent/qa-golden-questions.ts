// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۵ — ست ثابت سؤال‌های طلایی؛ قبل از
// فعال‌کردن هر مدل/پرامپت جدید در A/B، این‌ها خودکار روی یک فروشگاه واقعی اجرا می‌شوند تا
// ادمین سریع پاسخ‌ها را کنار هم ببیند (بازبینی انسانی، نه قضاوت خودکار). ویرایش این لیست فقط
// یعنی اضافه/کم‌کردن یک آیتم اینجا — بدون هیچ زیرساخت جدا.
export interface GoldenQuestion {
  id: string;
  category: string;
  question: string;
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
];
