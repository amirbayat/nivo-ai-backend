import {
  findUnauthorizedAmounts,
  parseFaAmounts,
  stripUnauthorizedPriceSentences,
} from './fa-amounts.util';

describe('parseFaAmounts [R1.4]', () => {
  it.each<[string, number[]]>([
    ['۴۵۰٬۰۰۰ تومان', [450_000]],
    ['450,000 تومان', [450_000]],
    ['450000 تومان', [450_000]],
    ['۴۵۰,۰۰۰ تومن', [450_000]],
    ['قیمتش ۴۵۰ هزار تومنه', [450_000]],
    ['۴۵۰ هزار', [450_000]],
    ['450 هزار تومان', [450_000]],
    ['۱.۲ میلیون', [1_200_000]],
    ['۱٫۲ میلیون تومان', [1_200_000]],
    ['۱/۵ میلیون', [1_500_000]],
    ['2 میلیون', [2_000_000]],
    ['۲ ملیون', [2_000_000]],
    ['۱.۵ میلیارد تومان', [1_500_000_000]],
    ['۴٬۵۰۰٬۰۰۰ ریال', [450_000]],
    ['۲ میلیون و ۵۰۰ هزار تومان', [2_500_000]],
    ['۱ میلیون و ۲۰۰ هزار و ۵۰۰ تومان', [1_200_500]],
    ['۱۲۰۰ تومان', [1200]],
    ['٤٥٠ هزار تومان', [450_000]],
    ['كفش ۴۵۰ هزار تومان و كیف ۲ میلیون', [450_000, 2_000_000]],
    ['قیمت ۱۰۰ تومان', [100]],
    ['از ۴۵۰ هزار تا ۵۰۰ هزار تومان', [450_000, 500_000]],
  ])('%s', (text, expected) => {
    expect(parseFaAmounts(text)).toEqual(expected);
  });

  it.each([
    'وزنش ۱۲۰۰ گرمه',
    'سایز ۴۲ موجوده',
    'تخفیف ۲۰ درصد',
    'کد سفارش NV12345',
    'شماره‌ات ۰۹۱۲۳۴۵۶۷۸۹ ثبت شد',
    'سه تا رنگ دارد',
    '',
  ])('مبلغ نیست: %s', (text) => {
    expect(parseFaAmounts(text)).toEqual([]);
  });
});

describe('findUnauthorizedAmounts / stripUnauthorizedPriceSentences [R1.4]', () => {
  const allowed = new Set([450_000, 900_000]);

  it('مبلغ مجاز در همه‌ی قالب‌ها پذیرفته می‌شود', () => {
    expect(findUnauthorizedAmounts('۴۵۰ هزار تومان یا ۴۵۰٬۰۰۰ تومان', allowed)).toEqual([]);
  });

  it('مبلغ غیرمجاز پیدا می‌شود', () => {
    expect(findUnauthorizedAmounts('این کفش ۳۹۰ هزار تومانه', allowed)).toEqual([390_000]);
  });

  it('فقط جمله‌ی حاوی مبلغ غلط حذف می‌شود و خط «روی کارت ببین» اضافه می‌شود', () => {
    const r = stripUnauthorizedPriceSentences(
      'سلام! این کفش ۳۹۰ هزار تومانه. رنگ مشکی هم دارد.',
      allowed,
      'قیمت دقیق رو روی کارت محصول ببین.',
    );
    expect(r.changed).toBe(true);
    expect(r.text).toContain('سلام!');
    expect(r.text).toContain('رنگ مشکی');
    expect(r.text).not.toContain('۳۹۰');
    expect(r.text.endsWith('قیمت دقیق رو روی کارت محصول ببین.')).toBe(true);
  });

  it('بدون مبلغ غلط متن دست‌نخورده می‌ماند', () => {
    const r = stripUnauthorizedPriceSentences('قیمتش ۴۵۰ هزار تومانه.', allowed, 'x');
    expect(r).toEqual({ text: 'قیمتش ۴۵۰ هزار تومانه.', changed: false });
  });
});
