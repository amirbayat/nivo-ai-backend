import { StoreService } from './store.service';

// PRD-nivo-sales-unified.md 3.2 — approve/reject/ship فقط به OrderStateService تفویض می‌شوند
// (منطق انتقال، قفل و اثرهای جانبی در test/order-state.e2e-spec.ts روی Postgres واقعی تست شده)
const order = {
  id: 'o1',
  storeId: 'st1',
  conversationId: 'cv1',
  status: 'RECEIPT_SUBMITTED',
  hasFulfillmentDelay: true, // تا requestReviewFollowUp اجرا نشود
};

const build = (transition: jest.Mock) => {
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, {
    orderState: { transition },
    getOwnedOrder: jest.fn().mockResolvedValue(order),
    requestReviewFollowUp: jest.fn(),
  });
  return svc;
};

describe('StoreService.approveOrder/rejectOrder/shipOrder → OrderStateService [3.2]', () => {
  it('approve: هشدار کمبود موجودی از ماشین وضعیت برمی‌گردد', async () => {
    const shortages = [{ name: 'کفش', requested: 2, available: 1 }];
    const transition = jest.fn().mockResolvedValue({
      changed: true,
      order: { ...order, status: 'APPROVED' },
      stockWarnings: shortages,
    });
    const r = await build(transition).approveOrder('s', 'st1', 'o1');
    expect(r.stockWarnings).toEqual(shortages);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        to: 'APPROVED',
        actor: 'SELLER',
        actorId: 's',
        channel: 'WEB',
      }),
    );
  });

  it('approve دوم (changed=false) → بدون هشدار و بدون پیگیری نظر', async () => {
    const transition = jest.fn().mockResolvedValue({
      changed: false,
      order: { ...order, status: 'APPROVED' },
      stockWarnings: [],
    });
    const svc = build(transition);
    (
      svc as unknown as { getOwnedOrder: jest.Mock }
    ).getOwnedOrder.mockResolvedValue({
      ...order,
      hasFulfillmentDelay: false,
    });
    const r = await svc.approveOrder('s', 'st1', 'o1');
    expect(r.stockWarnings).toEqual([]);
    expect(
      (svc as unknown as { requestReviewFollowUp: jest.Mock })
        .requestReviewFollowUp,
    ).not.toHaveBeenCalled();
  });

  it('approve سفارش غیر-تحویل‌زمان‌بر: پیگیری نظر بعد از تایید', async () => {
    const transition = jest.fn().mockResolvedValue({
      changed: true,
      order: { ...order, status: 'APPROVED' },
      stockWarnings: [],
    });
    const svc = build(transition);
    (
      svc as unknown as { getOwnedOrder: jest.Mock }
    ).getOwnedOrder.mockResolvedValue({
      ...order,
      hasFulfillmentDelay: false,
    });
    await svc.approveOrder('s', 'st1', 'o1', 'TELEGRAM');
    expect(
      (svc as unknown as { requestReviewFollowUp: jest.Mock })
        .requestReviewFollowUp,
    ).toHaveBeenCalledTimes(1);
    expect(transition.mock.calls[0][0].channel).toBe('TELEGRAM');
  });

  it('reject: دلیل به ماشین وضعیت داده می‌شود', async () => {
    const transition = jest.fn().mockResolvedValue({
      changed: true,
      order: { ...order, status: 'REJECTED' },
    });
    await build(transition).rejectOrder('s', 'st1', 'o1', 'ناموجود', 'WEB', undefined, true);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'REJECTED',
        data: { rejectReason: 'ناموجود', moneyReceived: true },
      }),
    );
  });

  it('ship: شرکت حمل نامعتبر رد می‌شود؛ معتبر با کد رهگیری به ماشین وضعیت می‌رود', async () => {
    const transition = jest.fn().mockResolvedValue({
      changed: true,
      order: { ...order, status: 'SHIPPED' },
    });
    const svc = build(transition);
    await expect(
      svc.shipOrder('s', 'st1', 'o1', { carrier: 'ناشناس' }),
    ).rejects.toThrow();
    expect(transition).not.toHaveBeenCalled();
    await svc.shipOrder('s', 'st1', 'o1', {
      carrier: 'تیپاکس',
      trackingCode: ' 12345 ',
    });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'SHIPPED',
        data: { carrier: 'تیپاکس', trackingCode: '12345' },
      }),
    );
  });
});
