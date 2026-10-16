import { BadRequestException, HttpException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SalesAgentService } from './sales-agent.service';
import { UiEventDto } from './dto/ui-event.dto';

// docs/PRD-buyer-chat-redesign.md B5 — POST v2/chat/:id/ui-events
describe('logUiEvent [BC-5 B5]', () => {
  function build(over: { token?: string; isTest?: boolean; isDemo?: boolean; count?: number } = {}) {
    const log = jest.fn();
    let n = over.count ?? 0;
    const svc = Object.create(SalesAgentService.prototype) as SalesAgentService;
    Object.assign(svc, {
      prisma: {
        salesConversation: {
          findUnique: async () => ({
            id: 'c1',
            storeId: 's1',
            isTest: over.isTest ?? false,
            customer: { sessionToken: 'tok' },
            store: { isDemo: over.isDemo ?? false },
          }),
        },
      },
      redis: { incr: async () => ++n, expire: async () => undefined },
      productEvents: { log },
    });
    return { svc, log };
  }
  const ev = (name: string, props?: Record<string, unknown>) => plainToInstance(UiEventDto, { name, props });

  it('logs a whitelisted event with store and conversation', async () => {
    const { svc, log } = build();
    await expect(svc.logUiEvent('c1', 'tok', ev('shop_view', { entry: 'shop_link', view: 'products' }))).resolves.toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith('shop_view', { storeId: 's1', conversationId: 'c1' }, { entry: 'shop_link', view: 'products' });
  });

  it('unknown event names are rejected by the DTO (400 through the validation pipe)', async () => {
    expect((await validate(ev('drop_table'))).length).toBeGreaterThan(0);
    expect(await validate(ev('cart_add', { ok: true }))).toHaveLength(0);
  });

  it('wrong session token is 401', async () => {
    const { svc } = build();
    await expect(svc.logUiEvent('c1', 'nope', ev('shop_view'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ForbiddenException).toBeDefined();
  });

  it('props over 1 KB are 400', async () => {
    const { svc, log } = build();
    await expect(svc.logUiEvent('c1', 'tok', ev('menu_item', { item: 'x'.repeat(1100) }))).rejects.toBeInstanceOf(BadRequestException);
    expect(log).not.toHaveBeenCalled();
  });

  it('61st event in a minute is 429', async () => {
    const { svc } = build({ count: 60 });
    await expect(svc.logUiEvent('c1', 'tok', ev('shop_view'))).rejects.toBeInstanceOf(HttpException);
  });

  it('test conversations and demo stores are tagged test=true', async () => {
    const a = build({ isTest: true });
    await a.svc.logUiEvent('c1', 'tok', ev('about_opened'));
    expect(a.log.mock.calls[0][2]).toEqual({ test: true });
    const b = build({ isDemo: true });
    await b.svc.logUiEvent('c1', 'tok', ev('cart_add', { ok: true }));
    expect(b.log.mock.calls[0][2]).toEqual({ ok: true, test: true });
  });
});
