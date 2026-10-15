import { ConflictException } from '@nestjs/common';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';
import { invalidateSalesAgentGlobalConfigCache } from '../sales-agent/sales-agent-global-config.util';

describe('onboarding slug [F5]', () => {
  afterEach(() => invalidateSalesAgentGlobalConfigCache());

  const store = {
    id: 'store-1',
    slug: 'old-slug',
    instagramUrl: 'https://instagram.com/shop',
    telegramUrl: 'https://t.me/shop',
    websiteUrl: 'https://shop.example',
  };

  const setup = (realConversations: number) => {
    const prisma = {
      salesConversation: {
        count: jest.fn(async () => realConversations),
      },
      store: {
        findUnique: jest.fn(async () => null),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...store,
          ...data,
        })),
        create: jest.fn(),
      },
      salesAgentGlobalConfig: {
        upsert: jest.fn(async () => ({
          id: 'singleton',
          trialDurationDays: 7,
          trialCreditToman: 1000,
        })),
      },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      getOwned: jest.fn(async () => store),
      assertBankCardPair: jest.fn(),
    });
    return { svc, prisma };
  };

  it('فروشگاه با گفتگوی واقعی نمی‌تواند slug را عوض کند', async () => {
    const { svc, prisma } = setup(1);
    await expect(
      svc.resumeOnboarding('seller-1', 'store-1', {
        slug: 'new-slug',
        name: 'فروشگاه',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('بدون گفتگوی واقعی slug عوض می‌شود', async () => {
    const { svc, prisma } = setup(0);
    await svc.resumeOnboarding('seller-1', 'store-1', {
      slug: 'new-slug',
      name: 'فروشگاه',
      instagramUrl: 'https://instagram.com/next',
    } as never);
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'new-slug' }),
      }),
    );
  });

  it('نبودن URLها مقدار قبلی را پاک نمی‌کند', async () => {
    const { svc, prisma } = setup(0);
    await svc.resumeOnboarding('seller-1', 'store-1', {
      slug: 'old-slug',
      name: 'فروشگاه',
    } as never);
    const data = prisma.store.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).not.toHaveProperty('instagramUrl');
    expect(data).not.toHaveProperty('telegramUrl');
    expect(data).not.toHaveProperty('websiteUrl');
  });

  it('برخورد یکتایی slug پیام گرفته‌شدن آدرس می‌دهد', async () => {
    const { svc, prisma } = setup(0);
    (prisma.store as unknown as { count: jest.Mock }).count = jest
      .fn()
      .mockResolvedValue(0);
    prisma.store.create.mockRejectedValue({ code: 'P2002', meta: { target: ['slug'] } });
    Object.assign(svc, {
      isSlugAvailable: jest.fn(async () => true),
      getSalesAgentGlobalConfig: undefined,
    });
    await expect(
      svc.create('seller-1', { slug: 'taken', name: 'فروشگاه' } as never),
    ).rejects.toMatchObject({ message: fa.store.slugTaken });
  });
});
