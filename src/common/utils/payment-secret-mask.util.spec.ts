import { maskPaymentSecrets } from './payment-secret-mask.util';

describe('maskPaymentSecrets', () => {
  it('removes a card and a SHEBA from a chat transcript before the model sees it', () => {
    const transcript =
      'card 6037-9912-3456-7890 and sheba IR060170000000000000000000';
    const masked = maskPaymentSecrets(transcript);
    expect(masked).not.toContain('6037-9912-3456-7890');
    expect(masked).not.toContain('6037991234567890');
    expect(masked).not.toContain('IR060170000000000000000000');
    expect(masked).toContain('6037-****-****-7890');
    expect(masked).toContain('IR06…0000');
  });

  it('leaves a 4-digit fragment alone', () => {
    expect(maskPaymentSecrets('چهار رقم آخر ۱۲۳۴')).toBe('چهار رقم آخر ۱۲۳۴');
  });
});
