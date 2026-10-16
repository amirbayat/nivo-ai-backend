import { AuthService } from './auth.service';

// DEMO-1 — گفتگوی فروشگاه دمو نباید bypass لیست انتظار بدهد
describe('AuthService.isLeadShopSignup', () => {
  const make = (store: { leadCaptureOnly: boolean; isDemo: boolean } | null) => {
    const svc = Object.create(AuthService.prototype) as any;
    svc.prisma = {
      salesConversation: { findUnique: jest.fn().mockResolvedValue(store ? { store } : null) },
    };
    return svc as { isLeadShopSignup: (l: { source?: string; conversationId?: string }) => Promise<boolean> };
  };
  const lead = { source: 'lead_shop', conversationId: 'c1' };

  it('فروشگاه لید نیوو → true', async () => {
    expect(await make({ leadCaptureOnly: true, isDemo: false }).isLeadShopSignup(lead)).toBe(true);
  });
  it('گفتگوی دمو → false (حتی با leadCaptureOnly قدیمی)', async () => {
    expect(await make({ leadCaptureOnly: true, isDemo: true }).isLeadShopSignup(lead)).toBe(false);
  });
});
