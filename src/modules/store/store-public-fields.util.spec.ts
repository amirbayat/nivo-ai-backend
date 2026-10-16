import { omitStoreSecrets, STORE_SENSITIVE_FIELDS } from './store-public-fields.util';
import { StoreService } from './store.service';

describe('Store secrets omitted [QA-3]', () => {
  const raw = {
    id: 's1',
    name: 'x',
    instagramAccessToken: 'IGsecret',
    instagramConnectedAt: new Date(),
    telegramConnectToken: 't',
    telegramConnectTokenExpiresAt: new Date(),
    sellerBotConnectToken: 'b',
    sellerBotConnectTokenExpiresAt: new Date(),
  };

  it('omitStoreSecrets drops every sensitive key and keeps the rest', () => {
    const out = omitStoreSecrets(raw) as Record<string, unknown>;
    for (const f of STORE_SENSITIVE_FIELDS) expect(out).not.toHaveProperty(f);
    expect(out.id).toBe('s1');
    expect(out.instagramConnectedAt).toBeDefined();
  });

  it('StoreService.list never returns the secrets', async () => {
    const prisma = {
      store: { findMany: jest.fn().mockResolvedValue([{ ...raw, products: [] }]) },
      salesConversation: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = new (StoreService as unknown as new (p: never) => StoreService)(prisma as never);
    const res = (await svc.list('u1')) as Record<string, unknown>[];
    expect(JSON.stringify(res)).not.toContain('IGsecret');
    for (const f of STORE_SENSITIVE_FIELDS) expect(res[0]).not.toHaveProperty(f);
    expect(res[0].slugLocked).toBe(false);
  });
});
