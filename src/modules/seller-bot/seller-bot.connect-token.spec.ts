import { SellerBotService } from './seller-bot.service';
import { fa } from '../../i18n/fa';

function build(opts: { store?: object | null; linkedElsewhere?: object | null; updateError?: unknown } = {}) {
  const sent: string[] = [];
  const prisma = {
    store: {
      findFirst: jest.fn().mockResolvedValue(opts.store === undefined ? { id: 's1', name: 'مهتاب' } : opts.store),
      findUnique: jest.fn().mockResolvedValue(opts.linkedElsewhere ?? null),
      update: jest.fn().mockResolvedValue({ id: 's1', name: 'مهتاب' }),
      updateMany: opts.updateError
        ? jest.fn().mockRejectedValue(opts.updateError)
        : jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const api = {
    sendText: jest.fn(async (_c: string, t: string) => void sent.push(t)),
  };
  const productEvents = { log: jest.fn() };
  const config = { get: (k: string) => (k === 'SELLER_BOT_USERNAME' ? 'nivo_seller_bot' : undefined) };
  const storeService = { getOwned: jest.fn().mockResolvedValue({ id: 's1' }) };
  const svc = new SellerBotService(
    prisma as never, config as never, {} as never, storeService as never, {} as never, api as never, {} as never, productEvents as never, {} as never, {} as never,
  );
  (svc as unknown as { sendMenu: unknown }).sendMenu = jest.fn(async (_c: string, t: string) => void sent.push(t));
  return { svc, prisma, sent, productEvents };
}

const start = (svc: SellerBotService, payload: string) =>
  (svc as unknown as { handleStart: (c: string, p: string) => Promise<void> }).handleStart('chat1', payload);

describe('seller bot one-tap connect [SP-7]', () => {
  it('createConnectToken stores a 15-minute token and returns the t.me deep link', async () => {
    const { svc, prisma } = build();
    const { url } = await svc.createConnectToken('u', 's1');
    const data = prisma.store.update.mock.calls[0][0].data;
    expect(url).toBe(`https://t.me/nivo_seller_bot?start=c_${data.sellerBotConnectToken}`);
    const ttl = data.sellerBotConnectTokenExpiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('valid token links the chat, clears the token and logs seller_bot_linked deeplink', async () => {
    const { svc, prisma, productEvents, sent } = build();
    await start(svc, 'c_abc');
    const q = prisma.store.findFirst.mock.calls[0][0].where;
    expect(q.sellerBotConnectToken).toBe('abc');
    expect(q.sellerBotConnectTokenExpiresAt.gt).toBeInstanceOf(Date);
    expect(prisma.store.updateMany.mock.calls[0][0].data).toMatchObject({
      sellerBotChatId: 'chat1', sellerBotConnectToken: null, sellerBotConnectTokenExpiresAt: null,
    });
    expect(productEvents.log).toHaveBeenCalledWith('seller_bot_linked', { storeId: 's1' }, { via: 'deeplink' });
    expect(sent[0]).toBe(fa.sellerBot.linked('مهتاب'));
  });

  it('expired or unknown token → expired message, nothing linked', async () => {
    const { svc, prisma, sent } = build({ store: null });
    await start(svc, 'c_old');
    expect(prisma.store.updateMany).not.toHaveBeenCalled();
    expect(sent).toEqual([fa.sellerBot.connectLinkExpired]);
  });

  it('chat already linked to another store is refused (not stolen)', async () => {
    const { svc, prisma, sent } = build({ linkedElsewhere: { id: 'OTHER' } });
    await start(svc, 'c_abc');
    expect(prisma.store.updateMany).not.toHaveBeenCalled();
    expect(sent).toEqual([fa.sellerBot.chatAlreadyLinkedElsewhere]);
  });

  it('unique-constraint race is refused too', async () => {
    const { svc, sent } = build({ updateError: { code: 'P2002' } });
    await start(svc, 'c_abc');
    expect(sent).toEqual([fa.sellerBot.chatAlreadyLinkedElsewhere]);
  });
});
