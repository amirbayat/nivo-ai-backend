import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoreService } from './store.service';

jest.mock('../sales-agent/sales-agent-global-config.util', () => ({
  getSalesAgentGlobalConfig: jest.fn().mockResolvedValue({ trialDurationDays: 7, trialCreditToman: 1000 }),
}));

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'x',
    meta: { target: ['slug'] },
  });

function build(opts: { takenSlugs?: string[]; failFirstCreates?: number } = {}) {
  const taken = new Set(opts.takenSlugs ?? []);
  let fails = opts.failFirstCreates ?? 0;
  const prisma = {
    store: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(async ({ where }: { where: { slug: string } }) =>
        taken.has(where.slug) ? { id: 'x' } : null,
      ),
      create: jest.fn(async ({ data }: { data: { slug: string } }) => {
        if (fails-- > 0) throw p2002();
        return { id: 'new', ...data };
      }),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  const productEvents = { log: jest.fn() };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, { prisma, productEvents, logger: { warn: jest.fn() } });
  return { svc, prisma, productEvents };
}

describe('StoreService.create slug resolution [SP-2]', () => {
  it('creates without a slug: transliterated from the name', async () => {
    const { svc, prisma } = build();
    const store = await svc.create('s1', { name: 'مهتاب' } as never);
    expect(store.slug).toBe('mhtab');
    expect(prisma.store.create).toHaveBeenCalledTimes(1);
  });

  it('taken requested slug gets -2 instead of a 409', async () => {
    const { svc } = build({ takenSlugs: ['mahtab'] });
    const store = await svc.create('s1', { name: 'x', slug: 'mahtab' } as never);
    expect(store.slug).toBe('mahtab-2');
  });

  it('P2002 race on the first attempt: two creates end with different slugs', async () => {
    const a = build({ failFirstCreates: 1 });
    const store = await a.svc.create('s1', { name: 'مهتاب' } as never);
    expect(a.prisma.store.create).toHaveBeenCalledTimes(2);
    expect(store.slug).toBe('mhtab-2');
    const b = build();
    const other = await b.svc.create('s2', { name: 'مهتاب' } as never);
    expect(other.slug).toBe('mhtab');
    expect(other.slug).not.toBe(store.slug);
  });

  it('gives up with a Persian 409 only after 5 retries', async () => {
    const { svc, prisma } = build({ failFirstCreates: 99 });
    await expect(svc.create('s1', { name: 'مهتاب' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.create).toHaveBeenCalledTimes(6);
  });

  it('logs store_created and records terms acceptance', async () => {
    const { svc, prisma, productEvents } = build();
    await svc.create('s1', { name: 'مهتاب', category: 'پوشاک' } as never);
    expect(productEvents.log).toHaveBeenCalledWith(
      'store_created',
      { storeId: 'new', userId: 's1' },
      { category: 'پوشاک', hasCustomSlug: false },
    );
    await new Promise((r) => setImmediate(r));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { termsAcceptedAt: expect.any(Date), termsVersion: '1404-07' },
    });
  });

  it('a failing terms write never breaks store creation', async () => {
    const { svc, prisma } = build();
    prisma.user.update.mockRejectedValue(new Error('column missing'));
    await expect(svc.create('s1', { name: 'مهتاب' } as never)).resolves.toMatchObject({ id: 'new' });
  });
});

describe('StoreService.update name/slug rules [SP-2]', () => {
  function buildUpdate(realConversations: number, takenSlugs: string[] = []) {
    const prisma = {
      salesConversation: { count: jest.fn().mockResolvedValue(realConversations) },
      store: {
        findUnique: jest.fn(async ({ where }: { where: { slug: string } }) =>
          takenSlugs.includes(where.slug) ? { id: 'x' } : null,
        ),
        update: jest.fn(async ({ data }: { data: object }) => ({ id: 'st', ...data })),
      },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      changeLog: { logMany: jest.fn() },
      getOwned: jest.fn().mockResolvedValue({ id: 'st', slug: 'old', name: 'Old' }),
    });
    return { svc, prisma };
  }

  it('slug change is locked after a real conversation', async () => {
    const { svc, prisma } = buildUpdate(1);
    await expect(svc.update('s1', 'st', { slug: 'new-slug' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('taken slug gives the Persian slugTaken error', async () => {
    const { svc } = buildUpdate(0, ['new-slug']);
    await expect(svc.update('s1', 'st', { slug: 'new-slug' } as never)).rejects.toThrow('این آدرس قبلاً گرفته شده');
  });

  it('name and free slug are saved when no real conversation exists', async () => {
    const { svc, prisma } = buildUpdate(0);
    await svc.update('s1', 'st', { name: 'New name', slug: 'new-slug' } as never);
    expect(prisma.store.update.mock.calls[0][0].data).toMatchObject({ name: 'New name', slug: 'new-slug' });
  });

  it('same slug as before never hits the lock', async () => {
    const { svc, prisma } = buildUpdate(5);
    await svc.update('s1', 'st', { slug: 'old', name: 'N2' } as never);
    expect(prisma.salesConversation.count).not.toHaveBeenCalled();
  });
});
