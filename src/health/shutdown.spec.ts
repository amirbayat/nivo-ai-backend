import { ShutdownService } from './shutdown.service';
import { LiveController } from './live.controller';
import { HealthController } from './health.controller';
import { shutdownGuard } from '../common/http/shutdown-guard';
import { isShuttingDown, resetShutdownStateForTests } from '../common/shutdown-state';
import { getActiveLlmTurns, runLlmTurn } from '../common/services/llm-turn-guard';

// R1.3 — SIGTERM وسط یک turn: پاسخ ذخیره می‌شود و بعد خروج؛ /live بی‌وابستگی؛ /health در خاموشی ۵۰۳
describe('graceful shutdown [R1.3]', () => {
  afterEach(() => resetShutdownStateForTests());

  it('beforeApplicationShutdown تا پایان turn در جریان صبر می‌کند', async () => {
    const saved: string[] = [];
    let finishTurn!: () => void;
    const turn = runLlmTurn(
      () =>
        new Promise<void>((resolve) => {
          finishTurn = () => {
            saved.push('reply-saved');
            resolve();
          };
        }),
    );
    expect(getActiveLlmTurns()).toBe(1);

    let shutdownDone = false;
    const shutdown = new ShutdownService()
      .beforeApplicationShutdown('SIGTERM')
      .then(() => {
        shutdownDone = true;
      });
    await new Promise((r) => setTimeout(r, 20));
    expect(isShuttingDown()).toBe(true);
    expect(shutdownDone).toBe(false); // هنوز منتظر turn

    finishTurn();
    await turn;
    await shutdown;
    expect(saved).toEqual(['reply-saved']);
    expect(shutdownDone).toBe(true);
    expect(getActiveLlmTurns()).toBe(0);
  });

  it('بدون turn فعال فوراً تمام می‌شود', async () => {
    await expect(new ShutdownService().beforeApplicationShutdown('SIGTERM')).resolves.toBeUndefined();
  });

  it('turn شکست‌خورده هم شمارنده را کم می‌کند', async () => {
    await expect(runLlmTurn(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(getActiveLlmTurns()).toBe(0);
  });

  it('/live همیشه ۲۰۰ و بدون وابستگی', () => {
    expect(new LiveController().live()).toEqual({ status: 'ok' });
  });

  it('/health در خاموشی ۵۰۳ می‌دهد', async () => {
    const health = new HealthController(
      { $queryRaw: jest.fn().mockResolvedValue([1]) } as never,
      { ping: jest.fn().mockResolvedValue('PONG') } as never,
    );
    await expect(health.check()).resolves.toEqual({ status: 'ok' });
    await new ShutdownService().beforeApplicationShutdown('SIGTERM');
    await expect(health.check()).rejects.toMatchObject({ status: 503 });
  });

  it('در خاموشی POST ۵۰۳ می‌گیرد و GET رد می‌شود', async () => {
    const run = (method: string) => {
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      shutdownGuard({ method } as never, res as never, next);
      return { res, next };
    };
    expect(run('POST').next).toHaveBeenCalled(); // هنوز خاموش نشده
    await new ShutdownService().beforeApplicationShutdown('SIGTERM');
    const post = run('POST');
    expect(post.next).not.toHaveBeenCalled();
    expect(post.res.status).toHaveBeenCalledWith(503);
    expect(run('GET').next).toHaveBeenCalled();
  });
});
