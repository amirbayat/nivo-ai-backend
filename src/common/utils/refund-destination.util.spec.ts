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
