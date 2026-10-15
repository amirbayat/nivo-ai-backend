import { validateAddressForm } from './address-form.util';

const valid = {
  recipientName: 'علی رضایی',
  recipientPhone: '09121234567',
  province: 'تهران',
  city: 'تهران',
  addressText: 'خیابان ولیعصر',
  postalCode: '1234567890',
  plaque: '12 الف',
  unit: '3',
};

describe('validateAddressForm', () => {
  it('normalizes +98, 0098, 98, and a leading 9 to 09XXXXXXXXX', () => {
    for (const phone of ['+989121234567', '00989121234567', '989121234567', '9121234567', '۰۹۱۲۱۲۳۴۵۶۷']) {
      const result = validateAddressForm({ ...valid, recipientPhone: phone });
      expect(result.ok).toBe(true);
      expect(result.values.recipientPhone).toBe('09121234567');
    }
  });

  it('keeps plaque letters and only trims', () => {
    const result = validateAddressForm({ ...valid, plaque: '  ۱۲ب  ' });
    expect(result.ok).toBe(true);
    expect(result.values.plaque).toBe('۱۲ب');
  });

  it('normalizes a postal code before checking the length', () => {
    const ok = validateAddressForm({ ...valid, postalCode: '۱۲۳۴۵-۶۷۸۹۰' });
    expect(ok.ok).toBe(true);
    expect(ok.values.postalCode).toBe('1234567890');
    const bad = validateAddressForm({ ...valid, postalCode: '12345 6789' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.postal).toBeTruthy();
    expect(bad.values.postalCode).toBe('123456789');
    expect(bad.values.city).toBe('تهران');
  });

  it('returns one error per bad field and keeps the entered values', () => {
    const result = validateAddressForm({
      ...valid,
      recipientName: ' ',
      recipientPhone: '02112345678',
      province: 'ناموجود',
      city: '',
      addressText: '',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeTruthy();
    expect(result.errors.phone).toBeTruthy();
    expect(result.errors.province).toBeTruthy();
    expect(result.errors.city).toBeTruthy();
    expect(result.errors.street).toBeTruthy();
    expect(result.errors.postal).toBeUndefined();
    expect(result.values.plaque).toBe('12 الف');
  });
});
