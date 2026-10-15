import { estimateConversationsLeft } from './credit-estimate.util';

describe('estimateConversationsLeft [R3.4]', () => {
  it('کمتر از ۲۰ مکالمه ← null (عدد نشان داده نمی‌شود)', () => {
    expect(estimateConversationsLeft(100_000, 19_000, 19)).toBeNull();
    expect(estimateConversationsLeft(100_000, 0, 0)).toBeNull();
  });
  it('میانگین هزینه‌ی هر مکالمه ← تعداد باقی‌مانده (گرد به پایین)', () => {
    // میانگین = ۴۰۰۰۰۰ / ۲۰ = ۲۰٬۰۰۰ تومان
    expect(estimateConversationsLeft(100_000, 400_000, 20)).toBe(5);
    expect(estimateConversationsLeft(99_999, 400_000, 20)).toBe(4);
  });
  it('موجودی صفر یا منفی ← ۰', () => {
    expect(estimateConversationsLeft(0, 400_000, 20)).toBe(0);
    expect(estimateConversationsLeft(-5000, 400_000, 20)).toBe(0);
  });
  it('هزینه‌ی صفر (میانگین ۰) ← null', () => {
    expect(estimateConversationsLeft(100_000, 0, 50)).toBeNull();
  });
});
