import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadSignupService } from './lead-signup.service';

// docs/PRD-nivo-lead-shop-seller-signup.md §7 تست‌های ۵، ۶، ۸
describe('LeadSignupService', () => {
  function build(over: { leadOnly?: boolean; existing?: Record<string, unknown> | null; userPhone?: string } = {}) {
    const upsert = jest.fn(async () => ({}));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const notify = jest.fn(async () => ({}));
    const svc = Object.create(LeadSignupService.prototype) as LeadSignupService;
    Object.assign(svc, {
      logger: { warn: jest.fn() },
      prisma: {
        salesConversation: {
          findUnique: async () => ({
            id: 'c1',
            storeId: 's1',
            customer: { sessionToken: 'tok' },
            store: { leadCaptureOnly: over.leadOnly ?? true, sellerBotChatId: null },
          }),
          update: async () => ({}),
        },
        leadProfile: { findUnique: async () => over.existing ?? null, upsert, updateMany },
        conversationEvent: {
          findMany: async () => [
            { type: 'AGENT_REPLY', payload: { text: 'سلام' } },
            { type: 'CUSTOMER_MESSAGE', payload: { text: 'کفش می‌فروشم' } },
          ],
        },
        user: { findUnique: async () => ({ phone: over.userPhone ?? '09123456789' }) },
      },
      adminNotifications: { notify },
      sellerBotApi: { sendText: jest.fn() },
    });
    return { svc, upsert, updateMany, notify };
  }

  it('lead/phone on a regular store → 404', async () => {
    await expect(build({ leadOnly: false }).svc.submitPhone('c1', 'tok', '09123456789')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wrong session token → 403', async () => {
    await expect(build().svc.submitPhone('c1', 'bad', '09123456789')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalid phone → 400', async () => {
    await expect(build().svc.submitPhone('c1', 'tok', '12345')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submitPhone upserts one row with normalized phone, status and chat history', async () => {
    const { svc, upsert, notify } = build();
    await svc.submitPhone('c1', 'tok', '۰۹۱۲۳۴۵۶۷۸۹');
    const arg = (upsert.mock.calls[0] as unknown[])[0] as { where: unknown; create: Record<string, unknown> };
    expect(arg.where).toEqual({ storeId_conversationId: { storeId: 's1', conversationId: 'c1' } });
    expect(arg.create.phone).toBe('09123456789');
    expect(arg.create.signupStatus).toBe('PHONE_SUBMITTED');
    expect(arg.create.chatHistory).toEqual([
      { role: 'user', content: 'کفش می‌فروشم' },
      { role: 'assistant', content: 'سلام' },
    ]);
    expect(notify).toHaveBeenCalledWith('LEAD_SIGNUP', expect.any(String), expect.stringContaining('09123456789'), expect.anything());
  });

  it('submitPhone does not downgrade a verified lead', async () => {
    const { svc, upsert } = build({ existing: { signupStatus: 'VERIFIED' } });
    await svc.submitPhone('c1', 'tok', '09123456789');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('markVerified sets userId + VERIFIED, keeps a different lead phone', async () => {
    const { svc, upsert } = build({ existing: { phone: '09350000000', signupStatus: 'PHONE_SUBMITTED', signedUpAt: null } });
    await svc.markVerified('c1', 'tok', 'u1');
    const arg = (upsert.mock.calls[0] as unknown[])[0] as { update: Record<string, unknown> };
    expect(arg.update.userId).toBe('u1');
    expect(arg.update.signupStatus).toBe('VERIFIED');
    expect(arg.update).not.toHaveProperty('phone');
  });

  it('markStoreCreated swallows errors', async () => {
    const { svc, updateMany } = build();
    updateMany.mockRejectedValueOnce(new Error('column does not exist'));
    await expect(svc.markStoreCreated('u1')).resolves.toBeUndefined();
  });
});
