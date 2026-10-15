import { ConversationEngineService } from './conversation-engine.service';
import { invalidateSalesAgentGlobalConfigCache } from './sales-agent-global-config.util';
import { fa } from '../../i18n/fa';

// R1.2 — فروشگاه معلق و kill switch هوش مصنوعی: بدون هیچ call مدل
describe('suspended store and aiEnabled switch [R1.2]', () => {
  afterEach(() => invalidateSalesAgentGlobalConfigCache());

  const build = (opts: { storeStatus: 'ACTIVE' | 'SUSPENDED'; aiEnabled: boolean; state?: string }) => {
    const created: unknown[] = [];
    const prisma = {
      salesAgentGlobalConfig: {
        upsert: jest.fn(async () => ({ id: 'singleton', aiEnabled: opts.aiEnabled })),
      },
      conversationEvent: {
        create: jest.fn(async (arg: unknown) => {
          created.push(arg);
        }),
      },
    };
    const eng = Object.create(ConversationEngineService.prototype) as unknown as Record<string, unknown> & {
      handleMessageInner: (c: unknown, t: string) => Promise<{ reply: string; state: string }>;
      handleActionTurn: (c: unknown, a: unknown) => Promise<{ reply: string }>;
    };
    const turn = jest.fn();
    const reserve = jest.fn();
    const handoff = jest.fn(async () => ({
      reply: fa.salesAgent.aiDisabledHandoff,
      uiBlocks: [],
      state: 'HANDOFF_HUMAN',
    }));
    Object.assign(eng, {
      prisma,
      handleMessageTurn: turn,
      withTurnReservation: reserve,
      transitionToHandoff: handoff,
    });
    const conversation = {
      id: 'c1',
      storeId: 's1',
      currentState: opts.state ?? 'BROWSING',
      store: { status: opts.storeStatus },
    };
    return { eng, conversation, turn, reserve, handoff, created };
  };

  it('فروشگاه معلق ← پیام ثابت و ۰ call مدل (پیام و اکشن)', async () => {
    const { eng, conversation, turn, reserve } = build({ storeStatus: 'SUSPENDED', aiEnabled: true });
    const r = await eng.handleMessageInner(conversation, 'سلام');
    expect(r.reply).toBe(fa.store.suspended);
    const a = await eng.handleActionTurn(conversation, { type: 'CONFIRM_CART' });
    expect(a.reply).toBe(fa.store.suspended);
    expect(turn).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('aiEnabled=false ← handoff مهربان، پیام لاگ می‌شود، ۰ call مدل', async () => {
    const { eng, conversation, turn, reserve, handoff, created } = build({
      storeStatus: 'ACTIVE',
      aiEnabled: false,
    });
    const r = await eng.handleMessageInner(conversation, 'قیمت کفش؟');
    expect(r.reply).toBe(fa.salesAgent.aiDisabledHandoff);
    expect(handoff).toHaveBeenCalledWith(conversation, 'AI_DISABLED');
    expect(created).toHaveLength(1);
    expect(turn).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('aiEnabled=false و مکالمه از قبل handoff: دوباره handoff نمی‌شود', async () => {
    const { eng, conversation, handoff } = build({
      storeStatus: 'ACTIVE',
      aiEnabled: false,
      state: 'HANDOFF_HUMAN',
    });
    const r = await eng.handleMessageInner(conversation, 'سلام؟');
    expect(r.reply).toBe(fa.salesAgent.aiDisabledHandoff);
    expect(handoff).not.toHaveBeenCalled();
  });

  it('فروشگاه فعال و aiEnabled=true ← مسیر عادی turn', async () => {
    const { eng, conversation, turn, reserve } = build({ storeStatus: 'ACTIVE', aiEnabled: true });
    reserve.mockImplementation(async (_c: unknown, run: () => Promise<unknown>) => run());
    turn.mockResolvedValue({ reply: 'ok', uiBlocks: [], state: 'BROWSING' });
    const r = await eng.handleMessageInner(conversation, 'سلام');
    expect(r.reply).toBe('ok');
    expect(turn).toHaveBeenCalledTimes(1);
  });
});
