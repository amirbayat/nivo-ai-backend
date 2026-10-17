import { ForbiddenException } from '@nestjs/common';
import { SellerSupportTicketService, TICKET_REF_REGEX } from './seller-support-ticket.service';

const TID = '11111111-1111-1111-1111-111111111111';

function build(adminIds = '900') {
  const prisma = {
    supportTicket: { findUnique: jest.fn() },
    sellerSupportMessage: { create: jest.fn(), updateMany: jest.fn() },
  };
  const tickets = {
    onAdminReplied: jest.fn(),
    onStatusChanged: jest.fn(),
    createFromSellerBot: jest.fn(),
    addAdminReply: jest.fn(),
    addUserReply: jest.fn(),
  };
  const api = { sendText: jest.fn().mockResolvedValue(null), sendForceReply: jest.fn() };
  const sms = { sendFreeText: jest.fn() };
  const config = { get: (k: string) => (k === 'SELLER_SUPPORT_ADMIN_CHAT_IDS' ? adminIds : undefined) };
  const svc = new SellerSupportTicketService(prisma as never, config as never, tickets as never, api as never, sms as never);
  return { svc, prisma, tickets, api, sms };
}

describe('SellerSupportTicketService [seller-support]', () => {
  it('chatId ادمین از env شناسایی می‌شود', () => {
    const { svc } = build('900, 901');
    expect(svc.isAdminChat('901')).toBe(true);
    expect(svc.isAdminChat('5')).toBe(false);
  });

  it('ارجاع تیکت می‌سازد و به همه‌ی ادمین‌ها پیام با ref می‌فرستد', async () => {
    const { svc, tickets, api } = build('900,901');
    tickets.createFromSellerBot.mockResolvedValue({ ticket: { id: TID, aiSummary: 'خلاصه' }, created: true });
    const r = await svc.escalate({
      store: { id: 's1', name: 'شاپ', slug: 'shop' } as never,
      summary: 'مشکل پرداخت', reason: 'پول', lastMessage: 'سلام',
    });
    expect(r.created).toBe(true);
    expect(api.sendText).toHaveBeenCalledTimes(2);
    expect(api.sendText.mock.calls[0][1]).toMatch(TICKET_REF_REGEX);
  });

  it('جواب ادمین با reply روی پیام تیکت به addAdminReply می‌رود', async () => {
    const { svc, tickets } = build();
    await svc.handleAdminMessage({
      chat: { id: 900 }, text: 'جواب',
      reply_to_message: { chat: { id: 900 }, text: `تیکت\n[ref:t_${TID}]` },
    } as never);
    expect(tickets.addAdminReply).toHaveBeenCalledWith(TID, 'جواب');
  });

  it('جواب فروشنده روی تیکت بسته false برمی‌گرداند (می‌رود سراغ عامل)', async () => {
    const { svc, prisma, tickets } = build();
    prisma.supportTicket.findUnique.mockResolvedValue({ id: TID, storeId: 's1' });
    tickets.addUserReply.mockRejectedValue(new ForbiddenException());
    const ok = await svc.handleSellerTicketReply({ id: 's1', sellerId: 'u1' } as never, TID, 'سلام');
    expect(ok).toBe(false);
  });

  it('تیکت فروشگاه دیگر را قبول نمی‌کند', async () => {
    const { svc, prisma, tickets } = build();
    prisma.supportTicket.findUnique.mockResolvedValue({ id: TID, storeId: 'other' });
    const ok = await svc.handleSellerTicketReply({ id: 's1', sellerId: 'u1' } as never, TID, 'x');
    expect(ok).toBe(false);
    expect(tickets.addUserReply).not.toHaveBeenCalled();
  });
});
