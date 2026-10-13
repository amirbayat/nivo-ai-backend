import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { EnDigits, ToNumber } from './digits.decorators';

class WithType {
  @Type(() => Number)
  @ToNumber()
  qty!: number;
  @ToNumber() presets!: number[];
}

class Sample {
  @EnDigits() phone!: string;
  @ToNumber() price!: number;
}
const t = (o: Record<string, unknown>) => plainToInstance(Sample, o);

describe('EnDigits / ToNumber [0.14]', () => {
  it('EnDigits: فارسی و عربی → انگلیسی و trim', () => {
    expect(t({ phone: ' ۰۹۱۲۳۴۵۶۷۸۹ ' }).phone).toBe('09123456789');
    expect(t({ phone: '٠٩١٢٣٤٥٦٧٨٩' }).phone).toBe('09123456789');
  });
  it('EnDigits: غیررشته دست‌نخورده', () => {
    expect(t({ phone: 123 as never }).phone).toBe(123 as never);
    expect(t({ phone: undefined as never }).phone).toBeUndefined();
  });
  it.each([
    ['۱۲۰٬۰۰۰', 120000],
    ['۱۲۰,۰۰۰ تومان', 120000],
    ['١٢٣', 123],
    ['۱۲٫۵', 12.5],
    ['12.5', 12.5],
    [250, 250],
  ])('ToNumber(%p)', (input, expected) => {
    const v = t({ price: input as never }).price;
    if (Number.isNaN(expected)) expect(v).toBe(input);
    else expect(v).toBe(expected);
  });
  it('ToNumber: رشته‌ی نامعتبر/خالی دست‌نخورده برای خطای validator', () => {
    expect(t({ price: 'abc' as never }).price).toBe('abc');
    expect(t({ price: '' as never }).price).toBe('');
  });
});

describe('ToNumber با @Type(() => Number) و آرایه [0.14]', () => {
  it('مقدار خام فارسی با وجود Type هم درست خوانده می‌شود', () => {
    expect(plainToInstance(WithType, { qty: '۱۲' }).qty).toBe(12);
  });
  it('آرایه‌ی اعداد عضو‌به‌عضو', () => {
    expect(
      plainToInstance(WithType, { presets: ['۱۰۰', 200, '٣٠٠'] }).presets,
    ).toEqual([100, 200, 300]);
  });
});
