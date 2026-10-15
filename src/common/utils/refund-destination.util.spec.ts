import {
  bankNameForSheba,
  ibanOk,
  luhnOk,
  maskCard,
  parseDestination,
} from './refund-destination.util';

describe('refund destination', () => {
  it('accepts a Luhn-valid 16-digit card and rejects a tampered one', () => {
    expect(luhnOk('4111111111111111')).toBe(true);
    expect(luhnOk('4111111111111112')).toBe(false);
    expect(luhnOk('123')).toBe(false);
  });

  it('accepts Persian digits and a valid IR IBAN', () => {
    expect(ibanOk('IR060170000000000000000000')).toBe(true);
    expect(ibanOk('IR۰۶۰۱۷۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰')).toBe(true);
    expect(ibanOk('IR060170000000000000000001')).toBe(false);
  });

  it('masks the card and names the bank from the SHEBA bank code', () => {
    expect(maskCard('6037991234567890')).toBe('6037-99**-****-7890');
    expect(bankNameForSheba('IR060170000000000000000000')).toBe('بانک ملی');
  });

  it('adds IR to a 24-digit SHEBA [F21]', () => {
    const parsed = parseDestination('060170000000000000000000');
    expect(parsed?.type).toBe('SHEBA');
    expect(parsed?.plain).toBe('IR060170000000000000000000');
    expect(parseDestination('۰۶۰۱۷۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰')?.plain).toBe(
      'IR060170000000000000000000',
    );
    expect(parseDestination('060170000000000000000001')).toBeNull();
  });

  it('parseDestination never returns the raw value for an invalid number', () => {
    expect(parseDestination('4111-1111-1111-1111')?.plain).toBe('4111111111111111');
    expect(parseDestination('not-a-card')).toBeNull();
  });
});

import {
  looksLikeDestinationMessage,
  maskSensitiveNumbers,
} from './refund-destination.util';

describe('looksLikeDestinationMessage [R0.11]', () => {
  it.each([
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱',
    'کارتم: 4111111111111111',
    'IR062960000000100324200001',
    '062960000000100324200001',
  ])('%s → کارت/شبا', (text) => {
    expect(looksLikeDestinationMessage(text)).toBe(true);
  });

  it.each([
    'سلام',
    'من سفارش ۱۲۳۴ دارم و شماره‌ام ۰۹۱۲۳۴۵۶۷۸۹ است و کارت ۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱ را بفرستم؟',
    'کد پیگیری 1234567890123456789012 و یک توضیح خیلی طولانی اینجا',
    '41111111111111',
    '4111111111111111 و بعد یک جمله‌ی طولانی دیگه',
  ])('%s → کارت نیست', (text) => {
    expect(looksLikeDestinationMessage(text)).toBe(false);
  });
});

describe('maskSensitiveNumbers [R0.10]', () => {
  it('کارت ۱۶ رقمی (حتی Luhn نامعتبر) ماسک می‌شود', () => {
    expect(maskSensitiveNumbers('1234567812345678')).toBe('1234-****-****-5678');
    expect(maskSensitiveNumbers('کارتم ۱۲۳۴ ۵۶۷۸ ۱۲۳۴ ۵۶۷۸ هست')).toBe(
      'کارتم 1234-****-****-5678 هست',
    );
  });

  it('رشته‌ی ۲۴ رقمی ماسک می‌شود و هیچ ۱۶ رقم پشت‌هم باقی نمی‌ماند', () => {
    const out = maskSensitiveNumbers('IR062960000000100324200001 / 062960000000100324200001');
    expect(out).not.toMatch(/\d{16}/);
  });

  it('تلفن، مبلغ و متن عادی دست نمی‌خورد', () => {
    const text = 'شماره‌ام 09123456789 و مبلغ 450000 تومان، سفارش NV12345';
    expect(maskSensitiveNumbers(text)).toBe(text);
  });
});
