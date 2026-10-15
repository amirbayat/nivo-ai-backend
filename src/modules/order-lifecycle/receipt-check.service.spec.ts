import { createHash } from 'crypto';
import { generateObject } from 'ai';
import { RECEIPT_CHECK_PROMPT, ReceiptCheckService } from './receipt-check.service';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

const generateObjectMock = generateObject as jest.Mock;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type FindWhere = {
  receiptHash?: string;
  OR?: unknown;
  receiptCheck?: { path?: string[] };
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    storeId: 's1',
    orderCode: 'NVK7M2QX',
    receiptImageKey: 'r.jpg',
    receiptImageKeys: ['r.jpg'],
    receiptType: 'IMAGE',
    receiptHash: null,
    receiptCheck: null,
    totalAmount: 1000,
    createdAt: new Date('2026-10-13T10:00:00.000Z'),
    store: { bankCards: [{ cardNumber: '6037991234561234' }] },
    conversation: { customerId: 'c1' },
    ...overrides,
  };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    amountToman: 1000,
    dateTime: '2026-10-13T12:00:00+03:30',
    destCardLast4: '1234',
    trackingNumber: null,
    bankName: null,
    isLikelyReceipt: true,
    confidence: 0.9,
    ...overrides,
  };
}

describe('ReceiptCheckService.run [F16 F17 F18]', () => {
  const similar = { id: 'o-sim', orderCode: 'NVK7M2QY' };
  const duplicate = { id: 'o-dup', orderCode: 'NVK7M2QZ' };

  const setup = (opts: {
    row?: Record<string, unknown>;
    buffer?: Buffer;
    shaHit?: { id: string; orderCode: string } | null;
    ahashHit?: { id: string; orderCode: string } | null;
    trackHit?: { id: string; orderCode: string } | null;
  }) => {
    generateObjectMock.mockReset();
    generateObjectMock.mockResolvedValue({
      object: extraction(),
      providerMetadata: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const update = jest.fn(async () => ({}));
    const downloadImage = jest.fn(async () => opts.buffer ?? Buffer.from('not-an-image'));
    const notifyBuyer = jest.fn(async () => undefined);
    const notifySeller = jest.fn(async () => undefined);
    const findFirst = jest.fn(async (args: { where: FindWhere }) => {
      const hash = args.where.receiptHash;
      if (typeof hash === 'string' && hash.startsWith('sha256:')) return opts.shaHit ?? null;
      if (typeof hash === 'string' && hash.startsWith('ahash:')) return opts.ahashHit ?? null;
      if (args.where.OR) return opts.ahashHit ?? null;
      if (args.where.receiptCheck?.path?.[0] === 'trackingNumber') return opts.trackHit ?? null;
      return null;
    });
    const prisma = {
      order: {
        findUnique: jest.fn(async () => order(opts.row)),
        findFirst,
        update,
      },
    };
    const svc = Object.create(ReceiptCheckService.prototype) as ReceiptCheckService;
    Object.assign(svc, {
      prisma,
      storage: { downloadImage },
      ai: { buildClient: () => () => 'model' },
      rates: { getUsdtToman: jest.fn() },
      credits: { canSpend: jest.fn(async () => true), deductSafely: jest.fn() },
      notifications: { notifyBuyer, notifySeller },
      logger: { error: jest.fn(), warn: jest.fn() },
    });
    return { svc, update, downloadImage, notifyBuyer, notifySeller, findFirst };
  };

  const saved = (update: jest.Mock) => update.mock.calls[0][0].data as {
    receiptHash: string | null;
    receiptCheck: {
      match: string;
      reason?: string;
      meta?: { similarTo?: string; ahash?: string };
    };
  };

  it('asks for a Gregorian time with the Tehran offset [F15]', () => {
    expect(RECEIPT_CHECK_PROMPT).toContain('+03:30');
    expect(RECEIPT_CHECK_PROMPT.toLowerCase()).toContain('gregorian');
  });

  it('does not treat a similar picture as a duplicate [F16]', async () => {
    const { svc, update, notifySeller } = setup({ buffer: PNG, ahashHit: similar });
    Object.assign(svc, { perceptualAhash: async () => 'ahash:abc' });
    await svc.run('o1');
    expect(generateObjectMock).toHaveBeenCalled();
    const data = saved(update);
    expect(data.receiptCheck.match).not.toBe('DUPLICATE');
    expect(data.receiptHash?.startsWith('sha256:')).toBe(true);
    expect(data.receiptCheck.meta?.similarTo).toBe('NV-K7M2QY');
    expect(data.receiptCheck.meta?.ahash).toBe('ahash:abc');
    expect(notifySeller).toHaveBeenCalledWith(
      expect.objectContaining({
        botText: expect.stringContaining('شبیه رسید سفارش NV-K7M2QY'),
      }),
    );
  });

  it('marks a duplicate from the file sha256 without calling vision [F16]', async () => {
    const buf = Buffer.from('same-bytes');
    const sha = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
    const { svc, update } = setup({ buffer: buf, shaHit: duplicate });
    await svc.run('o1');
    expect(generateObjectMock).not.toHaveBeenCalled();
    const data = saved(update);
    expect(data.receiptHash).toBe(sha);
    expect(data.receiptCheck.match).toBe('DUPLICATE');
    expect(data.receiptCheck.meta?.similarTo).toBeUndefined();
  });

  it('marks a duplicate when the extracted tracking number is already in the store [F16]', async () => {
    const { svc, update, notifyBuyer } = setup({ trackHit: duplicate });
    generateObjectMock.mockResolvedValue({
      object: extraction({ trackingNumber: 'TR-100' }),
      providerMetadata: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await svc.run('o1');
    expect(generateObjectMock).toHaveBeenCalled();
    expect(saved(update).receiptCheck.match).toBe('DUPLICATE');
    expect(notifyBuyer).not.toHaveBeenCalled();
  });

  it('clears the previous badge when a fourth receipt arrives [F17]', async () => {
    const { svc, update, downloadImage } = setup({
      row: {
        receiptImageKey: 'd.jpg',
        receiptImageKeys: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
        receiptHash: 'sha256:kept',
        receiptCheck: { match: 'OK' },
      },
    });
    await svc.run('o1');
    expect(downloadImage).not.toHaveBeenCalled();
    const data = saved(update);
    expect(data.receiptCheck.match).toBe('UNREADABLE');
    expect(data.receiptCheck.reason).toBe('max_images');
    expect(data.receiptHash).toBe('sha256:kept');
  });

  it('texts the buyer only when the paid amount is below the order [F18]', async () => {
    const under = setup({});
    generateObjectMock.mockResolvedValueOnce({
      object: extraction({ amountToman: 500 }),
      providerMetadata: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await under.svc.run('o1');
    expect(under.notifyBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'RECEIPT_AMOUNT_MISMATCH' }),
    );

    const over = setup({});
    generateObjectMock.mockResolvedValueOnce({
      object: extraction({ amountToman: 1500 }),
      providerMetadata: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await over.svc.run('o1');
    expect(over.notifyBuyer).not.toHaveBeenCalled();

    const cardOnly = setup({});
    generateObjectMock.mockResolvedValueOnce({
      object: extraction({ destCardLast4: '9999' }),
      providerMetadata: {},
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await cardOnly.svc.run('o1');
    expect(cardOnly.notifyBuyer).not.toHaveBeenCalled();
  });
});
