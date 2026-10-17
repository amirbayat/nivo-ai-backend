import { replyIsClean, eligibleToStore, eligibleToLookup } from './semantic-cache';

const base = {
  sig: { intent: 'ASK_WARRANTY_RETURN_POLICY', negated: false } as const,
  state: 'BROWSING', cartEmpty: true, toolsCalled: ['answer_faq'], mutationHappened: false,
  uiBlockType: 'NONE', dependent: false, replyText: 'تا هفت روز می‌تونی مرجوع کنی به شرط سالم بودن بسته.',
};

describe('semantic cache eligibility', () => {
  it('جواب پاک ذخیره می‌شود', () => expect(eligibleToStore(base as never)).toBe(true));
  it.each(['قیمتش ۱۰۰ تومنه', 'موجوده', 'تا امروز', 'کد تخفیف بگیر', 'هزار نفر'])('جواب ناپاک رد: %s', (t) => {
    expect(replyIsClean(t)).toBe(false);
  });
  it('رقم فارسی رد', () => expect(replyIsClean('هفت روز ۷ روز')).toBe(false));
  it('ابزار غیرمجاز / جهش / سبد پر / بلاک UI رد', () => {
    expect(eligibleToStore({ ...base, toolsCalled: ['update_cart'] } as never)).toBe(false);
    expect(eligibleToStore({ ...base, mutationHappened: true } as never)).toBe(false);
    expect(eligibleToStore({ ...base, cartEmpty: false } as never)).toBe(false);
    expect(eligibleToStore({ ...base, uiBlockType: 'PRODUCT_CARD' } as never)).toBe(false);
  });
  it('نیت غیرمجاز و negated رد', () => {
    expect(eligibleToLookup({ ...base, sig: { intent: 'ASK_PRICE', negated: false } } as never)).toBe(false);
    expect(eligibleToLookup({ ...base, sig: { intent: 'ASK_SHIPPING', negated: true } } as never)).toBe(false);
  });
  it('state سبد/پرداخت رد', () => expect(eligibleToLookup({ ...base, state: 'CART' } as never)).toBe(false));
});
