import 'reflect-metadata';
import { StoreService } from './store.service';
import { SalesAgentController } from '../sales-agent/sales-agent.controller';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtGuard } from '../../common/guards/jwt.guard';

// PRD-nivo-sales-unified.md تسک‌های 0.8 (takeover) و 0.9 (گارد response-strategy)
describe('sendSellerMessage takeover [0.8]', () => {
  const build = (muted: boolean) => {
    const prisma = {
      conversationEvent: {
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
      salesConversation: { update: jest.fn() },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      telegramApi: { sendText: jest.fn() },
      getOwnedConversation: jest.fn().mockResolvedValue({
        isMutedForHuman: muted,
        customer: { channel: 'WEB' },
      }),
    });
    return { svc, prisma };
  };

  it('پیام فروشنده AI را ساکت می‌کند و رویداد SELLER_TAKEOVER ثبت می‌شود', async () => {
    const { svc, prisma } = build(false);
    await svc.sendSellerMessage('s', 'st', 'cv1', 'سلام');
    expect(prisma.salesConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isMutedForHuman: true } }),
    );
    const payloads = prisma.conversationEvent.create.mock.calls.map(
      (c) => c[0].data,
    );
    expect(payloads).toContainEqual(
      expect.objectContaining({
        type: 'SYSTEM',
        payload: { kind: 'SELLER_TAKEOVER' },
      }),
    );
  });

  it('اگر از قبل ساکت است، دوباره رویداد/آپدیت نمی‌سازد', async () => {
    const { svc, prisma } = build(true);
    await svc.sendSellerMessage('s', 'st', 'cv1', 'سلام');
    expect(prisma.salesConversation.update).not.toHaveBeenCalled();
  });
});

describe('response-strategy guard [0.9]', () => {
  it('فقط JwtGuard + AdminGuard', () => {
    const guards: unknown[] = Reflect.getMetadata(
      '__guards__',
      SalesAgentController.prototype.setResponseStrategy,
    );
    expect(guards).toEqual([JwtGuard, AdminGuard]);
  });
});
