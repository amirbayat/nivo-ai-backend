import { StoreService, conversationControl } from './store.service';
import { ConversationEngineService } from '../sales-agent/conversation-engine.service';
import { touchConversation } from '../sales-agent/conversation-touch.util';
import { SellerConversationFollowUpService } from '../sales-agent/seller-conversation-followup.service';

// docs/PRD-seller-conversations-inbox.md فازهای ۲ و ۴
describe('conversationControl', () => {
  it('BOT / SELLER / BOT_HANDOFF', () => {
    const base = {
      isMutedForHuman: false,
      currentState: 'BROWSING',
      humanTakenOverAt: null,
    };
    expect(conversationControl(base)).toBe('BOT');
    expect(conversationControl({ ...base, isMutedForHuman: true })).toBe(
      'BOT_HANDOFF',
    );
    expect(
      conversationControl({
        ...base,
        currentState: 'HANDOFF_HUMAN',
        isMutedForHuman: true,
      }),
    ).toBe('BOT_HANDOFF');
    expect(
      conversationControl({
        ...base,
        isMutedForHuman: true,
        humanTakenOverAt: new Date(),
      }),
    ).toBe('SELLER');
  });
});

describe('touchConversation', () => {
  it('پیام مشتری هر دو ستون را می‌نویسد، بات/فروشنده فقط lastMessageAt', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { salesConversation: { updateMany } };
    await touchConversation(prisma as never, 'c1', 'CUSTOMER');
    await touchConversation(prisma as never, 'c1', 'AGENT');
    expect(updateMany.mock.calls[0][0].data).toHaveProperty(
      'lastCustomerMessageAt',
    );
    expect(updateMany.mock.calls[1][0].data).not.toHaveProperty(
      'lastCustomerMessageAt',
    );
    expect(updateMany.mock.calls[1][0].data).toHaveProperty('lastMessageAt');
  });

  it('خطا چت را نمی‌شکند', async () => {
    const prisma = {
      salesConversation: {
        updateMany: jest.fn().mockRejectedValue(new Error('db')),
      },
    };
    await expect(
      touchConversation(prisma as never, 'c1', 'SELLER'),
    ).resolves.toBeUndefined();
  });
});

describe('mute / unmute', () => {
  const build = (conv: Record<string, unknown>) => {
    const prisma = {
      salesConversation: { update: jest.fn((a: any) => a) },
      conversationEvent: { create: jest.fn((a: any) => a) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      logger: { error: jest.fn() },
      creditDeduction: {
        reevaluateBlockedConversations: jest.fn().mockResolvedValue(undefined),
      },
      getOwnedConversation: jest.fn().mockResolvedValue(conv),
    });
    return { svc, prisma };
  };

  it('mute: humanTakenOverAt + رویداد SELLER_TAKEOVER', async () => {
    const { svc, prisma } = build({
      isMutedForHuman: false,
      humanTakenOverAt: null,
    });
    await svc.muteConversation('s', 'st', 'c1');
    expect(prisma.salesConversation.update.mock.calls[0][0].data).toMatchObject(
      {
        isMutedForHuman: true,
        humanTakenOverAt: expect.any(Date),
      },
    );
    expect(
      prisma.conversationEvent.create.mock.calls[0][0].data.payload,
    ).toEqual({
      kind: 'SELLER_TAKEOVER',
    });
  });

  it('mute تکراری: بدون نوشتن', async () => {
    const { svc, prisma } = build({
      isMutedForHuman: true,
      humanTakenOverAt: new Date(),
    });
    await svc.muteConversation('s', 'st', 'c1');
    expect(prisma.salesConversation.update).not.toHaveBeenCalled();
  });

  it('unmute: humanTakenOverAt=null + رویداد BACK_TO_BOT', async () => {
    const { svc, prisma } = build({
      isMutedForHuman: true,
      humanTakenOverAt: new Date(),
    });
    await svc.unmuteConversation('s', 'st', 'c1');
    expect(prisma.salesConversation.update.mock.calls[0][0].data).toMatchObject(
      {
        isMutedForHuman: false,
        humanTakenOverAt: null,
      },
    );
    expect(
      prisma.conversationEvent.create.mock.calls[0][0].data.payload,
    ).toEqual({
      kind: 'BACK_TO_BOT',
    });
  });
});

describe('race: دست‌گرفتن وسط تولید جواب AI [۴.۴]', () => {
  const build = (row: unknown, persistedReply: unknown = null) => {
    const prisma = {
      salesConversation: { findUnique: jest.fn().mockResolvedValue(row) },
      conversationEvent: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(persistedReply),
      },
    };
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as {
      dropIfSellerTookOver: (
        c: { id: string },
        r: unknown,
        startedAt: Date,
        endedAt: Date,
      ) => Promise<{ reply: string }>;
    };
    Object.assign(eng, { prisma });
    return { eng, prisma };
  };
  const result = { reply: 'سلام', uiBlocks: [], state: 'BROWSING' };
  const t0 = new Date(Date.now() - 5000);
  const t1 = new Date();

  it('اگر فروشنده دست گرفته: reply خالی + رویداد AI_REPLY_DROPPED_TAKEOVER', async () => {
    const { eng, prisma } = build({
      isMutedForHuman: true,
      humanTakenOverAt: new Date(),
    });
    const out = await eng.dropIfSellerTookOver({ id: 'c1' }, result, t0, t1);
    expect(out.reply).toBe('');
    expect(
      prisma.conversationEvent.create.mock.calls[0][0].data.payload,
    ).toEqual({
      kind: 'AI_REPLY_DROPPED_TAKEOVER',
    });
  });

  it('handoff خودکار بات (بدون humanTakenOverAt) جواب را نمی‌اندازد', async () => {
    const { eng, prisma } = build({
      isMutedForHuman: true,
      humanTakenOverAt: null,
    });
    const out = await eng.dropIfSellerTookOver({ id: 'c1' }, result, t0, t1);
    expect(out.reply).toBe('سلام');
    expect(prisma.conversationEvent.create).not.toHaveBeenCalled();
  });

  it('جوابی که قبل از دست‌گرفتن ذخیره شده ارسال می‌شود (همان که فروشنده در تاریخچه می‌بیند)', async () => {
    const { eng, prisma } = build(
      { isMutedForHuman: true, humanTakenOverAt: new Date() },
      { id: 'e1' },
    );
    const out = await eng.dropIfSellerTookOver({ id: 'c1' }, result, t0, t1);
    expect(out.reply).toBe('سلام');
    expect(prisma.conversationEvent.create).not.toHaveBeenCalled();
    expect(
      prisma.conversationEvent.findFirst.mock.calls[0][0].where.createdAt,
    ).toEqual({ gte: t0, lte: t1 });
  });
});

describe('listConversations — آرشیوشده‌ها [۴.۳]', () => {
  const build = () => {
    const prisma = {
      salesConversation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      getOwned: jest.fn().mockResolvedValue({}),
    });
    return { svc, prisma };
  };
  const whereOf = (prisma: { salesConversation: { findMany: jest.Mock } }) =>
    JSON.stringify(prisma.salesConversation.findMany.mock.calls[0][0].where);

  it('«نیاز به شما» آرشیوشده (سفارش تکمیل/رد) را نشان نمی‌دهد', async () => {
    const { svc, prisma } = build();
    await svc.listConversations('s', 'st', {});
    expect(whereOf(prisma)).toContain('"archivedAt":null');
  });

  it('«همه» و «سفارش‌دار» تاریخچه‌ی آرشیوشده را نگه می‌دارند', async () => {
    for (const filter of ['all', 'ordered']) {
      const { svc, prisma } = build();
      await svc.listConversations('s', 'st', { filter });
      expect(whereOf(prisma)).not.toContain('archivedAt');
    }
  });
});

describe('برگشت خودکار ۱۲ ساعته [۴.۵]', () => {
  it('مثل «برگردون به بات» دستی: بازارزیابی اعتبار فروشگاه + clarifyAttempts=0، بدون دست زدن به currentState', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'c1', storeId: 'st1' },
        { id: 'c2', storeId: 'st1' },
      ]),
      salesConversation: { update: jest.fn((a: any) => a) },
      conversationEvent: { create: jest.fn((a: any) => a) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const creditDeduction = {
      reevaluateBlockedConversations: jest.fn().mockResolvedValue(0),
    };
    const svc = new SellerConversationFollowUpService(
      prisma as never,
      {} as never,
      {} as never,
      creditDeduction as never,
    );
    expect(await svc.autoReturnStaleConversations()).toBe(2);
    expect(creditDeduction.reevaluateBlockedConversations).toHaveBeenCalledTimes(1);
    const data = prisma.salesConversation.update.mock.calls[0][0].data;
    expect(data).toEqual({
      isMutedForHuman: false,
      humanTakenOverAt: null,
      clarifyAttempts: 0,
    });
  });
});
