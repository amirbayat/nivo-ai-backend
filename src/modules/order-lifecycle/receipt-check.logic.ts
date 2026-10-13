// Step 5 (3.9). Pure comparison of a vision extraction against the order.
// Amount must match exactly. The buyer is never told a receipt is fake.

export type ReceiptExtraction = {
  amountToman: number | null;
  dateTime: string | null;
  destCardLast4: string | null;
  trackingNumber: string | null;
  bankName: string | null;
  isLikelyReceipt: boolean;
  confidence: number;
};

export type ReceiptMatch = 'OK' | 'MISMATCH' | 'UNREADABLE' | 'DUPLICATE';

export type ReceiptCheckResult = {
  match: ReceiptMatch;
  overpaidToman: number;
  duplicateOrderCode?: string;
  amountToman: number | null;
  destCardLast4: string | null;
  trackingNumber: string | null;
  bankName: string | null;
  cardOk: boolean | null;
  timeOk: boolean | null;
  costUsd?: number;
  reason?: string;
};

export function compareReceipt(input: {
  extraction: ReceiptExtraction;
  expectedAmountToman: number;
  orderCreatedAt: Date;
  storeCardLast4: string[];
}): ReceiptCheckResult {
  const e = input.extraction;
  const base = {
    overpaidToman: 0,
    amountToman: e.amountToman,
    destCardLast4: e.destCardLast4,
    trackingNumber: e.trackingNumber,
    bankName: e.bankName,
    cardOk: null as boolean | null,
    timeOk: null as boolean | null,
  };
  if (!e.isLikelyReceipt || e.amountToman == null || !Number.isFinite(e.amountToman)) {
    return { ...base, match: 'UNREADABLE', reason: 'unreadable' };
  }
  const amount = Math.round(e.amountToman);
  let cardOk: boolean | null = null;
  if (e.destCardLast4 && input.storeCardLast4.length > 0) {
    const last4 = e.destCardLast4.replace(/\D/g, '').slice(-4);
    cardOk = input.storeCardLast4.includes(last4);
  }
  let timeOk: boolean | null = null;
  if (e.dateTime) {
    const t = Date.parse(e.dateTime);
    timeOk = Number.isFinite(t) ? t >= input.orderCreatedAt.getTime() - 5 * 60_000 : null;
  }
  const amountOk = amount === input.expectedAmountToman;
  const overpaidToman = amount > input.expectedAmountToman ? amount - input.expectedAmountToman : 0;
  const mismatch = !amountOk || cardOk === false || timeOk === false;
  return {
    ...base,
    amountToman: amount,
    cardOk,
    timeOk,
    overpaidToman,
    match: mismatch ? 'MISMATCH' : 'OK',
  };
}
