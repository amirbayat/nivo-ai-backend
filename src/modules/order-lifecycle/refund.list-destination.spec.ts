import { RefundService } from './refund.service';

function row(status: 'READY' | 'DONE', enc: string) {
  return {
    id: status === 'READY' ? 'ready-1' : 'done-1',
    orderId: 'o1',
    status,
    destinationEnc: enc,
    destinationMasked: '6037-99**-****-1111',
    amountToman: 1000,
    reason: 'ORDER_REJECTED',
    note: null,
    destinationType: 'CARD',
    holderName: 'Ali',
    bankName: null,
    paidRef: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    order: {
      id: 'o1',
      orderCode: 'NVK7M2QX',
      recipientName: null,
      conversation: { customer: { fullName: 'Buyer' } },
    },
  };
}

describe('refund list destination [F22]', () => {
  const svc = Object.create(RefundService.prototype) as RefundService;
  Object.assign(svc, {
    ownedStore: async () => undefined,
    decryptIf: (enc: string | null) => (enc ? `plain-${enc}` : null),
    prisma: {
      orderRefund: {
        findMany: async () => [row('READY', 'enc-ready'), row('DONE', 'enc-done')],
      },
    },
  });

  it('returns the full number only while the refund is ready to pay', async () => {
    const rows = await svc.list('seller', 'store');
    const ready = rows.find((r) => r.status === 'READY');
    const done = rows.find((r) => r.status === 'DONE');
    expect(ready?.destination).toBe('plain-enc-ready');
    expect(ready?.destinationMasked).toBe('6037-99**-****-1111');
    expect(done?.destination).toBeNull();
    expect(done?.destinationMasked).toBe('6037-99**-****-1111');
  });
});
