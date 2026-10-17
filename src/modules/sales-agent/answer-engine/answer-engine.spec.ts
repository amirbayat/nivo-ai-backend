import { isContextDependent } from './context-dependence';
import { normalizeFa } from './normalize';
import { buildSignature, type SigContext } from './signature';

const ctx: SigContext = {
  catalog: [{ id: 'p1', name: 'مانتو لینن' }, { id: 'p2', name: 'شال ابریشمی' }],
  optionValues: ['سبزآبی'],
};
const sig = (t: string, c: SigContext = ctx) => buildSignature(t, c);

describe('normalizeFa [ACE-9]', () => {
  it.each([
    ['قيمتش چنده؟', 'قیمتش چنده ?'],
    ['كتاب', 'کتاب'],
    ['می‌خوام', 'می خوام'],
    ['سایز ۴۰ دارید؟؟؟', 'سایز 40 دارید ?'],
    ['سایز ٤٠', 'سایز 40'],
    ['قیمـــتش', 'قیمتش'],
    ['سلااااام', 'سلاام'],
    ['XL  داری؟', 'xl داری ?'],
    ['موجوده؟ 😍🙏', 'موجوده ?'],
    ['۱٬۲۰۰٬۰۰۰ تومن', '1200000 تومن'],
    ['  فاصله   زیاد  ', 'فاصله زیاد'],
    ['قِیمَت', 'قیمت'],
  ])('%s', (i, o) => expect(normalizeFa(i)).toBe(o));
});

describe('intent [ACE-9]', () => {
  it.each([
    ['قیمتش چنده؟', 'ASK_PRICE'],
    ['چقدره؟', 'ASK_PRICE'],
    ['مانتو لینن چند میدی', 'ASK_PRICE'],
    ['قیمت شال ابریشمی', 'ASK_PRICE'],
    ['چنده این؟', 'ASK_PRICE'],
    ['موجوده؟', 'STOCK_CHECK'],
    ['دارین؟', 'STOCK_CHECK'],
    ['مانتو لینن هست؟', 'STOCK_CHECK'],
    ['کی میرسه؟', 'ASK_SHIPPING'],
    ['چند روزه میاد؟', 'ASK_SHIPPING'],
    ['هزینه ارسال به تهران؟', 'ASK_SHIPPING'],
    ['پس میگیرین؟', 'ASK_WARRANTY_RETURN_POLICY'],
    ['تعویض داره؟', 'ASK_WARRANTY_RETURN_POLICY'],
    ['کارت به کارت میشه؟', 'ASK_PAYMENT_METHODS'],
    ['چطوری پول بدم؟', 'ASK_PAYMENT_METHODS'],
    ['پرداخت در محل دارین؟', 'ASK_CASH_ON_DELIVERY'],
    ['ارزون‌ترش نمیشه؟', 'NEGOTIATE_PRICE'],
    ['تخفیف میدی؟', 'NEGOTIATE_PRICE'],
    ['قیمت آخرش چنده', 'NEGOTIATE_PRICE'],
    ['سلام', 'UNCLEAR'],
    ['قیمت و موجودی؟', 'UNCLEAR'],
    ['قیمتش با ارسال به مشهد چنده', 'UNCLEAR'],
    ['یه چیز خوب میخوام', 'UNCLEAR'],
  ])('%s → %s', (t, i) => expect(sig(t).intent).toBe(i));

  it('سایز/رنگ + موجودی → VARIANT_REQUEST', () => {
    expect(sig('مانتو لینن سایز L داره؟').intent).toBe('VARIANT_REQUEST');
    expect(sig('مشکیش هست؟').intent).toBe('VARIANT_REQUEST');
  });
});

describe('جفت‌های گول‌زننده: امضا باید فرق کند [ACE-9]', () => {
  const differs = (a: string, b: string) =>
    expect(JSON.stringify(sig(a))).not.toBe(JSON.stringify(sig(b)));
  const key = (t: string) => { const s = sig(t); return `${s.intent}|${s.entities.join(',')}|${s.negated}|${s.scope}`; };
  const keyDiffers = (a: string, b: string) => expect(key(a)).not.toBe(key(b));

  it('سایز L ≠ سایز XL', () => keyDiffers('سایز L داره؟', 'سایز XL داره؟'));
  it('مشکیش هست ≠ مشکیش نیست', () => keyDiffers('مشکیش هست؟', 'مشکیش نیست؟'));
  it('ارسال به تهران ≠ ارسال به مشهد', () => keyDiffers('ارسال به تهران چقدر؟', 'ارسال به مشهد چقدر؟'));
  it('سایز ۴۰ ≠ سایز ۴۲', () => keyDiffers('سایز ۴۰ دارین؟', 'سایز ۴۲ دارین؟'));
  it('مشکی ≠ سفید', () => keyDiffers('مشکی داره؟', 'سفید داره؟'));
  it('مانتو ≠ شال (scope)', () => keyDiffers('مانتو لینن چنده؟', 'شال ابریشمی چنده؟'));
  it('۵۰ گرم ≠ ۱۰۰ گرم', () => keyDiffers('۵۰ گرم موجوده؟', '۱۰۰ گرم موجوده؟'));
  it('قیمت ≠ موجودی', () => keyDiffers('مانتو لینن چنده؟', 'مانتو لینن موجوده؟'));
  it('همان سؤال با املای محاوره‌ای/عربی → امضای یکسان', () => {
    expect(key('قيمت مانتو لینن چنده؟')).toBe(key('مانتو لینن چقدره'));
    expect(key('قیمتش چنده؟؟')).toBe(key('قیمتش چنده'));
    expect(key('سایز L داره؟')).toBe(key('سایز l داره'));
  });
  void differs;
});

describe('entities و scope [ACE-9]', () => {
  it('شهر، رنگ، سایز، واحد، محصول', () => {
    expect(sig('ارسال به مشهد').entities).toContain('geo:مشهد');
    expect(sig('مشکی').entities).toContain('opt:مشکی');
    expect(sig('سایز ۳۸').entities).toContain('size:38');
    expect(sig('xl').entities).toContain('size:xl');
    expect(sig('۵۰۰ گرم').entities).toContain('unit:500گرم');
    expect(sig('مانتو لینن').entities).toContain('prod:p1');
    expect(sig('سبزآبی داره؟').entities).toContain('opt:سبزآبی');
  });
  it('scope: محصول نام‌برده‌شده > لنگر > تک‌کارت > store', () => {
    expect(sig('مانتو لینن چنده؟').scope).toBe('p:p1');
    expect(sig('چنده؟', { ...ctx, anchoredProductId: 'p9' }).scope).toBe('p:p9');
    expect(sig('چنده؟', { ...ctx, lastShownProductIds: ['p7'] }).scope).toBe('p:p7');
    expect(sig('چنده؟', { ...ctx, lastShownProductIds: ['p7', 'p8'] }).scope).toBe('store');
    expect(sig('پس میگیرین؟', { ...ctx, anchoredProductId: 'p9' }).scope).toBe('store');
  });
  it('negated', () => {
    expect(sig('نداره؟').negated).toBe(true);
    expect(sig('بدون کش دارین؟').negated).toBe(true);
    expect(sig('موجوده؟').negated).toBe(false);
  });
});

describe('isContextDependent [ACE-9]', () => {
  it.each([
    ['اینم داری؟', true],
    ['اون قبلیه چنده؟', true],
    ['همین', true],
    ['آره', true],
    ['باشه', true],
    ['نه', true],
    ['۲', true],
    ['و رنگ دیگه؟', true],
    ['ولی ارزونتر نداری؟', true],
    ['پس چطور پرداخت کنم؟', true],
    ['قیمتش چنده؟ موجوده؟', true],
    ['قیمت؟ و همینطور ارسال', true],
    ['اولی چنده؟', true],
    ['قیمت مانتو لینن چنده؟', false],
    ['پس میگیرین؟', true],
    ['مرجوعی دارین؟', false],
    ['ارسال به تهران چقدر؟', false],
  ])('%s → %s', (t, dep) => expect(isContextDependent({ text: t })).toBe(dep));

  it('state سبد/پرداخت → همیشه وابسته', () => {
    expect(isContextDependent({ text: 'مرجوعی دارین؟', currentState: 'CART' })).toBe(true);
    expect(isContextDependent({ text: 'مرجوعی دارین؟', currentState: 'BROWSING' })).toBe(false);
  });
  it('اسم محصول صریح ضمیر را خنثی می‌کند', () => {
    expect(isContextDependent({ text: 'این مانتو چنده؟', mentionsProduct: true })).toBe(false);
    expect(isContextDependent({ text: 'این مانتو چنده؟' })).toBe(true);
  });
  it('پاسخ کوتاه بعد از سؤال بات', () => {
    expect(isContextDependent({ text: 'سایز ۴۰', lastBotAskedQuestion: true })).toBe(true);
  });
});
