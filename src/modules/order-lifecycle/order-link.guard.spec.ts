import { ensureBuyerOrderLink } from './order-link.util';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';

jest.mock('../sales-agent/sales-agent-global-config.util', () => ({
  getSalesAgentGlobalConfig: jest.fn(),
}));
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';

const mockedConfig = getSalesAgentGlobalConfig as jest.Mock;

function prismaMock() {
  return {
    shortLink: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('ensureBuyerOrderLink guards [R3.8]', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  it('فلگ روشن ولی ORDER_LINK_SECRET نیست ← null و هیچ ShortLink ساخته نمی‌شود', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: true });
    delete process.env.ORDER_LINK_SECRET;
    process.env.APP_URL = 'https://nivoai.ir';
    const prisma = prismaMock();
    expect(await ensureBuyerOrderLink(prisma as never, 'o1')).toBeNull();
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });

  it('secret خالی/فاصله هم «نیست» حساب می‌شود', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: true });
    process.env.ORDER_LINK_SECRET = '   ';
    process.env.APP_URL = 'https://nivoai.ir';
    const prisma = prismaMock();
    expect(await ensureBuyerOrderLink(prisma as never, 'o1')).toBeNull();
  });

  it('APP_URL نیست ← null (لینک نسبیِ شکسته در پیامک/چت نمی‌رود)', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: true });
    process.env.ORDER_LINK_SECRET = 's3cret';
    delete process.env.APP_URL;
    const prisma = prismaMock();
    expect(await ensureBuyerOrderLink(prisma as never, 'o1')).toBeNull();
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });

  it('فلگ خاموش ← null', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: false });
    process.env.ORDER_LINK_SECRET = 's3cret';
    process.env.APP_URL = 'https://nivoai.ir';
    expect(await ensureBuyerOrderLink(prismaMock() as never, 'o1')).toBeNull();
  });

  it('همه‌چیز آماده ← لینک مطلق ساخته می‌شود', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: true });
    process.env.ORDER_LINK_SECRET = 's3cret';
    process.env.APP_URL = 'https://nivoai.ir/';
    const prisma = prismaMock();
    const url = await ensureBuyerOrderLink(prisma as never, 'o1');
    expect(url).toMatch(/^https:\/\/nivoai\.ir\/o\/[A-Z0-9]+$/);
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(1);
  });
});

describe('notification text without link when link unavailable [R3.8]', () => {
  it('بدون secret، متن بدون خط لینک می‌رود', async () => {
    mockedConfig.mockResolvedValue({ orderPublicLinkEnabled: true });
    delete process.env.ORDER_LINK_SECRET;
    process.env.APP_URL = 'https://nivoai.ir';
    const svc = Object.create(NotificationDeliveryService.prototype) as unknown as {
      withLink: (t: string | null, id: string) => Promise<string | null>;
    };
    Object.assign(svc, { prisma: prismaMock(), logger: { warn: jest.fn() } });
    expect(await svc.withLink('سفارش تایید شد', 'o1')).toBe('سفارش تایید شد');
  });
});
