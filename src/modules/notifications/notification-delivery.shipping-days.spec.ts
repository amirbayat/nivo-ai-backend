import { NotificationDeliveryService } from './notification-delivery.service';

type Priv = { chatText: (job: unknown, order: unknown) => string | null };

function svc() {
  return Object.create(NotificationDeliveryService.prototype) as unknown as Priv;
}
const job = { template: 'ORDER_APPROVED', data: {} };
const baseOrder = {
  id: 'o1',
  orderCode: 'NV-1',
  totalAmount: 1000,
  recipientPhone: null,
  conversationId: 'c1',
};

describe('ORDER_APPROVED message with shipping days [R3.3]', () => {
  it('بازه‌ی روز کاری در متن تایید می‌آید', () => {
    const text = svc().chatText(job, {
      ...baseOrder,
      store: { name: 'x', shippingDaysMin: 2, shippingDaysMax: 4 },
    });
    expect(text).toContain('معمولاً ۲–۴ روز کاری ارسال می‌شه');
  });
  it('بدون بازه همان متن قبلی', () => {
    const text = svc().chatText(job, {
      ...baseOrder,
      store: { name: 'x', shippingDaysMin: null, shippingDaysMax: null },
    });
    expect(text).toContain('به‌زودی ارسال می‌شه');
  });
});
