import { SellerBotService } from './seller-bot.service';

describe('handleRefunds [F22]', () => {
  it('sends the mask and a panel link, not the full number', async () => {
    const sendText = jest.fn(async (..._args: unknown[]) => undefined);
    const svc = Object.create(SellerBotService.prototype) as SellerBotService;
    Object.assign(svc, {
      getLinkedStore: async () => ({ sellerId: 'seller', id: 'store' }),
      refunds: {
        list: async () => [
          {
            id: 'r1',
            orderCode: 'NV-K7M2QX',
            amountToman: 1500,
            destination: '6037991234561234',
            destinationMasked: '6037-99**-****-1234',
          },
        ],
      },
      api: { sendText },
      config: { get: (key: string) => (key === 'APP_URL' ? 'https://nivo.example/' : undefined) },
    });
    await svc['handleRefunds']('chat-1');
    const call = sendText.mock.calls[0];
    const text = String(call[1]);
    expect(text).toContain('6037-99**-****-1234');
    expect(text).not.toContain('6037991234561234');
    expect(call[2]).toEqual({
      inline_keyboard: [
        [{ text: 'واریز کردم', callback_data: 'sbrf:r1' }],
        [{ text: 'کپی در پنل', url: 'https://nivo.example/seller/panel/refunds' }],
      ],
    });
  });
});
