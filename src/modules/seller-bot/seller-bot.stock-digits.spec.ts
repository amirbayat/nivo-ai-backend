import { SellerBotService } from './seller-bot.service';

// docs/PRD-fixes-after-buyer-redesign.md S11 — پاسخ موجودی با عدد فارسی («۱۲») پذیرفته می‌شود
describe('seller bot stock reply digits [FX-4 S11]', () => {
  function build() {
    const updateProduct = jest.fn().mockResolvedValue({});
    const sendMenu = jest.fn().mockResolvedValue(undefined);
    const svc = Object.create(SellerBotService.prototype) as Record<string, any>;
    Object.assign(svc, {
      getLinkedStore: jest.fn().mockResolvedValue({ id: 's1', sellerId: 'u1' }),
      prisma: { product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', storeId: 's1', name: 'مانتو', trackStock: true }) } },
      storeService: { updateProduct },
      sendMenu,
    });
    return { svc, updateProduct, sendMenu };
  }
  const msg = (text: string) => ({ chat: { id: 7 }, text });

  it.each([['۱۲', 12], ['١٢', 12], ['12', 12]])('%s → %d', async (text, n) => {
    const { svc, updateProduct } = build();
    await svc.handleStockUpdateMessage(msg(text), 'p1');
    expect(updateProduct).toHaveBeenCalledWith('u1', 's1', 'p1', { stock: n });
  });

  it('non-numeric text is still rejected', async () => {
    const { svc, updateProduct, sendMenu } = build();
    await svc.handleStockUpdateMessage(msg('دوازده'), 'p1');
    expect(updateProduct).not.toHaveBeenCalled();
    expect(sendMenu).toHaveBeenCalled();
  });
});
