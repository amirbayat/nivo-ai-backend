import { ConflictException } from '@nestjs/common';
import { SellerBotService } from './seller-bot.service';

function service(order: { receiptVerifiedMatch: boolean | null }, approve: jest.Mock) {
  const sendText = jest.fn(async (..._args: unknown[]) => undefined);
  const svc = Object.create(SellerBotService.prototype) as SellerBotService;
  Object.assign(svc, {
    getLinkedStore: async () => ({ sellerId: 'seller', id: 'store' }),
    prisma: { order: { findUnique: async () => ({ id: 'order-a', storeId: 'store', ...order }) } },
    config: { get: (key: string) => (key === 'APP_URL' ? 'https://nivo.example' : undefined) },
    api: { sendText },
    storeService: { approveOrder: approve },
  });
  return { svc, sendText, approve };
}

describe('approve from the receipt notification [5.35]', () => {
  it('approves only when the receipt check matched', async () => {
    const approve = jest.fn(async () => ({ stockWarnings: [] }));
    const { svc, approve: approveOrder, sendText } = service(
      { receiptVerifiedMatch: true },
      approve,
    );
    await svc['handleApproveFromNotification']('chat', 'order-a');
    expect(approveOrder).toHaveBeenCalledWith('seller', 'store', 'order-a', 'TELEGRAM');
    expect(sendText).toHaveBeenCalled();
  });

  it('sends the order page when the check did not match', async () => {
    const approve = jest.fn();
    const { svc, sendText } = service({ receiptVerifiedMatch: false }, approve);
    await svc['handleApproveFromNotification']('chat', 'order-a');
    expect(approve).not.toHaveBeenCalled();
    expect(String(sendText.mock.calls[0][1])).toContain(
      'https://nivo.example/seller/panel/orders?orderId=order-a',
    );
  });

  it('tells the seller when the order was already decided', async () => {
    const approve = jest.fn(async () => {
      throw new ConflictException('already');
    });
    const { svc, sendText } = service({ receiptVerifiedMatch: true }, approve);
    await svc['handleApproveFromNotification']('chat', 'order-a');
    expect(sendText).toHaveBeenCalledWith('chat', 'already');
  });
});
