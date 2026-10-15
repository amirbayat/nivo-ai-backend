import { CtxLogger } from './ctx-logger';
import { logCtx, setLogCtx } from './log-context';

// R1.3 — لاگ مسیر چت conversationId و storeId دارد
describe('CtxLogger / logCtx [R1.3]', () => {
  it('بدون context چیزی اضافه نمی‌شود', () => {
    expect(logCtx()).toBe('');
  });

  it('بعد از setLogCtx همه‌ی لاگ‌های همان جریان async پسوند دارند', async () => {
    const out: string[] = [];
    const logger = new CtxLogger();
    jest.spyOn(Object.getPrototypeOf(CtxLogger.prototype), 'error').mockImplementation((m: unknown) => {
      out.push(String(m));
    });
    await Promise.resolve().then(async () => {
      setLogCtx({ conversationId: 'conv-1', storeId: 'store-1' });
      await new Promise((r) => setTimeout(r, 5));
      logger.error('turn failed');
    });
    expect(out).toEqual(['turn failed [conversationId=conv-1 storeId=store-1]']);
    jest.restoreAllMocks();
  });
});
