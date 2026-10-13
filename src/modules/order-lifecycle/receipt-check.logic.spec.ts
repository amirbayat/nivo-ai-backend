import { compareReceipt, ReceiptExtraction } from './receipt-check.logic';

const base: ReceiptExtraction = {
  amountToman: 1250000,
  dateTime: '2026-10-13T12:00:00.000Z',
  destCardLast4: '1234',
  trackingNumber: '99',
  bankName: 'ملت',
  isLikelyReceipt: true,
  confidence: 0.9,
};

const orderCreatedAt = new Date('2026-10-13T10:00:00.000Z');

describe('compareReceipt', () => {
  it('matches an exact amount and the store card', () => {
    const r = compareReceipt({
      extraction: base,
      expectedAmountToman: 1250000,
      orderCreatedAt,
      storeCardLast4: ['1234'],
    });
    expect(r.match).toBe('OK');
    expect(r.overpaidToman).toBe(0);
  });

  it('flags a lower amount and an overpayment separately', () => {
    const low = compareReceipt({
      extraction: { ...base, amountToman: 1200000 },
      expectedAmountToman: 1250000,
      orderCreatedAt,
      storeCardLast4: ['1234'],
    });
    expect(low.match).toBe('MISMATCH');
    const high = compareReceipt({
      extraction: { ...base, amountToman: 1300000 },
      expectedAmountToman: 1250000,
      orderCreatedAt,
      storeCardLast4: ['1234'],
    });
    expect(high.match).toBe('MISMATCH');
    expect(high.overpaidToman).toBe(50000);
  });

  it('is unreadable when the image is not a receipt', () => {
    const r = compareReceipt({
      extraction: { ...base, isLikelyReceipt: false, amountToman: null },
      expectedAmountToman: 1250000,
      orderCreatedAt,
      storeCardLast4: [],
    });
    expect(r.match).toBe('UNREADABLE');
  });

  it('mismatches a destination card that is not the store card', () => {
    const r = compareReceipt({
      extraction: base,
      expectedAmountToman: 1250000,
      orderCreatedAt,
      storeCardLast4: ['9999'],
    });
    expect(r.match).toBe('MISMATCH');
    expect(r.cardOk).toBe(false);
  });
});
