import { ConversationEngineService } from './conversation-engine.service';

// 3.8 — «رسید ندارم»: بدون عکس، همان RECEIPT_SUBMITTED با receiptType=MANUAL_INFO
type Engine = {
  handleManualReceipt: (
    c: unknown,
    info: { cardLast4: string; approxTime: string; trackingCode?: string },
  ) => Promise<{ reply: string; state: string }>;
};

const build = (status = 'PENDING_PAYMENT', changed = true) => {
  const transition = jest.fn().mockResolvedValue({ changed, order: {} });
  const sellerBotApi = { sendText: jest.fn().mockResolvedValue(undefined) };
  const eng = Object.create(
    ConversationEngineService.prototype,
  ) as unknown as Engine;
  Object.assign(eng, {
    prisma: {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'o1', orderCode: 'NVK7M2QX', status }),
      },
    },
    orderState: { transition },
    orderChannelOf: jest.fn().mockResolvedValue('WEB'),
    persistTransition: jest.fn(),
    lock: {
      acquireWithRetry: jest.fn().mockResolvedValue('t'),
      acquire: jest.fn().mockResolvedValue('t'),
      release: jest.fn(),
      drain: jest.fn().mockResolvedValue([]),
      pendingCount: jest.fn().mockResolvedValue(0),
    },
    reloadConversation: (c: unknown) => Promise.resolve(c),
    getContext: jest.fn().mockReturnValue({}),
    logReply: jest.fn(),
    doClarify: jest
      .fn()
      .mockResolvedValue({ reply: 'noPending', uiBlocks: [], state: 'X' }),
    sellerBotApi,
    logger: { error: jest.fn() },
  });
  return { eng, transition, sellerBotApi };
};
const conv = {
  id: 'cv1',
  currentState: 'AWAITING_PAYMENT',
  store: { sellerBotChatId: '123' },
};
const info = {
  cardLast4: '1234',
  approxTime: 'حدود ۱۴:۳۰',
  trackingCode: '998',
};

describe('handleManualReceipt [3.8]', () => {
  it('انتقال با MANUAL_INFO + اعلان به فروشنده با دکمه‌های تایید/رد و برچسب بدون عکس', async () => {
    const { eng, transition, sellerBotApi } = build();
    const r = await eng.handleManualReceipt(conv, info);
    expect(r.state).toBe('AWAITING_SELLER_APPROVAL');
    expect(r.reply).toContain('NV-K7M2QX');
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'RECEIPT_SUBMITTED',
        actor: 'BUYER',
        data: { receiptType: 'MANUAL_INFO', receiptManualInfo: info },
      }),
    );
    const [chatId, text, keyboard] = sellerBotApi.sendText.mock.calls[0] as [
      string,
      string,
      { inline_keyboard: { callback_data: string }[][] },
    ];
    expect(chatId).toBe('123');
    expect(text).toContain('بدون عکس رسید');
    expect(text).toContain('1234');
    expect(keyboard.inline_keyboard[0].map((b) => b.callback_data)).toEqual([
      'sbap:o1',
      'sbrj:o1',
    ]);
  });

  it('سفارش غیر PENDING_PAYMENT → رد (بدون انتقال و اعلان)', async () => {
    const { eng, transition, sellerBotApi } = build('APPROVED');
    const r = await eng.handleManualReceipt(conv, info);
    expect(r.reply).toBe('noPending');
    expect(transition).not.toHaveBeenCalled();
    expect(sellerBotApi.sendText).not.toHaveBeenCalled();
  });

  it('ثبت هم‌زمان (changed=false) → دوباره اعلان نمی‌شود', async () => {
    const { eng, sellerBotApi } = build('PENDING_PAYMENT', false);
    const r = await eng.handleManualReceipt(conv, info);
    expect(r.reply).toBe('noPending');
    expect(sellerBotApi.sendText).not.toHaveBeenCalled();
  });

  it('خطای اعلان فروشنده → همچنان موفق', async () => {
    const { eng, sellerBotApi } = build();
    sellerBotApi.sendText.mockRejectedValue(new Error('tg down'));
    const r = await eng.handleManualReceipt(conv, info);
    expect(r.state).toBe('AWAITING_SELLER_APPROVAL');
  });
});
