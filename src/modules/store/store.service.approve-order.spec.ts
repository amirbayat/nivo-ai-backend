import { StoreService } from './store.service';

// PRD-nivo-sales-unified.md تسک‌های 0.3 (هشدار کمبود موجودی) و 0.13b (تایید دوگانه)
const order = {
  id: 'o1',
  storeId: 'st1',
  conversationId: 'cv1',
  status: 'RECEIPT_SUBMITTED',
  bankCardId: null,
  totalAmount: 2000,
  hasFulfillmentDelay: true, // تا requestReviewFollowUp اجرا نشود
  items: [{ productId: 'p1', name: 'کفش', qty: 2, unitPrice: 1000 }],
};

const build = (claimCount: number, liveStock = 1) => {
  const productDelegate = {
    updateMany: jest.fn(),
    findFirst: jest.fn().mockResolvedValue({ stock: liveStock }),
  };
  // اولین updateMany (شرط stock>=qty) شکست می‌خورد؛ دومی (clamp) موفق
  productDelegate.updateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValue({ count: 1 });
  const tx = {
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...order, status: 'APPROVED' }),
    },
    storeBankCard: { update: jest.fn() },
    product: productDelegate,
    productVariant: productDelegate,
    salesConversation: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, {
    prisma,
    getOwnedOrder: jest.fn().mockResolvedValue(order),
  });
  return { svc, tx, productDelegate };
};

describe('StoreService.approveOrder [0.3][0.13b]', () => {
  it('کمبود موجودی: clamp می‌شود ولی هشدار صریح برمی‌گردد', async () => {
    const { svc } = build(1, 1);
    const r = await svc.approveOrder('s', 'st1', 'o1');
    expect(r.status).toBe('APPROVED');
    expect(r.stockWarnings).toEqual([
      { name: 'کفش', requested: 2, available: 1 },
    ]);
  });

  it('تایید دوم (claim ناموفق) → بدون کسر موجودی/سقف کارت و بدون هشدار', async () => {
    const { svc, tx, productDelegate } = build(0);
    const r = await svc.approveOrder('s', 'st1', 'o1');
    expect(r.stockWarnings).toEqual([]);
    expect(productDelegate.updateMany).not.toHaveBeenCalled();
    expect(tx.storeBankCard.update).not.toHaveBeenCalled();
    expect(tx.salesConversation.update).not.toHaveBeenCalled();
  });

  it('claim فقط از وضعیت‌های قابل‌تایید انجام می‌شود', async () => {
    const { svc, tx } = build(1);
    await svc.approveOrder('s', 'st1', 'o1');
    const where = tx.order.updateMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(
      expect.arrayContaining([
        'PENDING_PAYMENT',
        'RECEIPT_SUBMITTED',
        'REJECTED',
      ]),
    );
    expect(where.status.in).not.toContain('APPROVED');
    expect(where.status.in).not.toContain('SHIPPED');
  });
});
