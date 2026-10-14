import { HttpException } from '@nestjs/common';
import { SalesAgentService } from './sales-agent.service';
import { invalidateSalesAgentGlobalConfigCache } from './sales-agent-global-config.util';

describe('startTestChat [F4]', () => {
  afterEach(() => invalidateSalesAgentGlobalConfigCache());

  const setup = () => {
    const customers: { id: string; sessionToken: string }[] = [];
    const createdConversations: { isTest?: boolean }[] = [];
    const prisma = {
      store: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'store-1',
          sellerId: 'seller-1',
          name: 'فروشگاه',
          logoImageKey: null,
          isDemo: false,
        }),
      },
      customer: {
        findFirst: jest.fn(async () => customers[0] ?? null),
        create: jest.fn(async ({ data }: { data: { sessionToken: string } }) => {
          const row = { id: 'customer-1', sessionToken: data.sessionToken };
          customers.push(row);
          return row;
        }),
        update: jest.fn(
          async ({ data }: { data: { sessionToken: string } }) => {
            const current = customers[0];
            if (!current) throw new Error('missing test customer');
            customers[0] = { ...current, sessionToken: data.sessionToken };
            return customers[0];
          },
        ),
      },
      salesConversation: {
        create: jest.fn(async ({ data }: { data: { isTest?: boolean } }) => {
          createdConversations.push(data);
          return { id: 'conv-1', responseStrategy: 'BALANCED' };
        }),
      },
      salesAgentGlobalConfig: {
        upsert: jest.fn(async () => ({
          id: 'singleton',
          forcedModelVariant: null,
          shopStreamEnabled: false,
          shopLandingEnabled: false,
        })),
      },
    };
    const redis = {
      incr: jest.fn(async () => 1),
      expire: jest.fn(async () => 1),
    };
    const svc = Object.create(SalesAgentService.prototype) as SalesAgentService;
    Object.assign(svc, {
      prisma,
      redis,
      creditService: { decideBillingMode: jest.fn(async () => 'PAID') },
      buildInitialReply: jest.fn(async () => null),
    });
    return { svc, prisma, redis, customers, createdConversations };
  };

  it('پنج بار باز کردن فقط یک Customer می‌سازد', async () => {
    const { svc, prisma, createdConversations } = setup();
    for (let i = 0; i < 5; i++) {
      await svc.startTestChat('seller-1', 'store-1');
    }
    expect(prisma.customer.create).toHaveBeenCalledTimes(1);
    expect(prisma.customer.update).toHaveBeenCalledTimes(4);
    expect(prisma.salesConversation.create).toHaveBeenCalledTimes(5);
    expect(createdConversations[0]?.isTest).toBe(true);
  });

  it('بالای ۲۰ بار در ساعت رد می‌شود', async () => {
    const { svc, prisma, redis } = setup();
    redis.incr.mockResolvedValue(21);
    await expect(svc.startTestChat('seller-1', 'store-1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
