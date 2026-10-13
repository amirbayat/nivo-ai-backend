import { ConversationEngineService } from './conversation-engine.service';

type Engine = {
  handleMessageInner: (
    c: unknown,
    t: string,
  ) => Promise<{ reply: string; state: string }>;
  handleActionInner: (c: unknown, a: unknown) => Promise<{ reply: string }>;
};

function makeEngine(reserve: boolean) {
  const svc = Object.create(
    ConversationEngineService.prototype,
  ) as unknown as Engine;
  const creditService = {
    reserveTurn: jest.fn().mockResolvedValue(reserve),
    releaseTurn: jest.fn().mockResolvedValue(undefined),
  };
  const handleMessageTurn = jest
    .fn()
    .mockResolvedValue({ reply: 'ok', uiBlocks: [], state: 'BROWSING' });
  const transitionToHandoff = jest
    .fn()
    .mockResolvedValue({
      reply: 'handoff',
      uiBlocks: [],
      state: 'HANDOFF_HUMAN',
    });
  Object.assign(svc, { creditService, handleMessageTurn, transitionToHandoff });
  return { svc, creditService, handleMessageTurn, transitionToHandoff };
}

const conv = { id: 'c1', storeId: 'st1', billingMode: 'PAID' };

describe('1.2(۱) — کف overdraft در موتور', () => {
  it('رزرو موفق: turn اجرا و رزرو آزاد می‌شود', async () => {
    const { svc, creditService, handleMessageTurn } = makeEngine(true);
    const r = await svc.handleMessageInner(conv, 'سلام');
    expect(r.reply).toBe('ok');
    expect(handleMessageTurn).toHaveBeenCalledTimes(1);
    expect(creditService.releaseTurn).toHaveBeenCalledWith('st1');
  });

  it('زیر کف: turn اجرا نمی‌شود، handoff با BILLING_BLOCKED، رزروی آزاد نمی‌شود', async () => {
    const { svc, creditService, handleMessageTurn, transitionToHandoff } =
      makeEngine(false);
    const r = await svc.handleMessageInner(conv, 'سلام');
    expect(r.reply).toBe('handoff');
    expect(handleMessageTurn).not.toHaveBeenCalled();
    expect(transitionToHandoff).toHaveBeenCalledWith(conv, 'BILLING_BLOCKED');
    expect(creditService.releaseTurn).not.toHaveBeenCalled();
  });

  it('خطای turn هم رزرو را آزاد می‌کند', async () => {
    const { svc, creditService, handleMessageTurn } = makeEngine(true);
    handleMessageTurn.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.handleMessageInner(conv, 'سلام')).rejects.toThrow('boom');
    expect(creditService.releaseTurn).toHaveBeenCalledWith('st1');
  });

  it('مکالمه‌ی از قبل BLOCKED رزرو نمی‌خواهد', async () => {
    const { svc, creditService, handleMessageTurn } = makeEngine(false);
    await svc.handleMessageInner({ ...conv, billingMode: 'BLOCKED' }, 'سلام');
    expect(creditService.reserveTurn).not.toHaveBeenCalled();
    expect(handleMessageTurn).toHaveBeenCalledTimes(1);
  });
});
