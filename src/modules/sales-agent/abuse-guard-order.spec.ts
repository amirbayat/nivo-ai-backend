import { ConversationEngineService } from './conversation-engine.service';

describe('2.6 — گارد سوءاستفاده قبل از هر write', () => {
  it('کاربر قفل‌شده هیچ ConversationEvent ای نمی‌سازد', async () => {
    const svc = Object.create(
      ConversationEngineService.prototype,
    ) as ConversationEngineService;
    const create = jest.fn();
    Object.assign(svc, {
      prisma: { conversationEvent: { create } },
      abuseGuard: {
        checkAndRecord: jest
          .fn()
          .mockResolvedValue({ blocked: true, justLocked: false }),
      },
    });
    const conversation = {
      id: 'c1',
      customerId: 'cu1',
      currentState: 'BROWSING',
    };
    const result = await (
      svc as unknown as {
        handleMessageInner: (c: unknown, t: string) => Promise<{ reply: string }>;
      }
    ).handleMessageInner(conversation, 'spam');
    expect(result.reply).toBe('');
    expect(create).not.toHaveBeenCalled();
  });
});
