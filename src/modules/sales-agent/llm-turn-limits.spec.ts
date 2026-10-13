import * as guard from '../../common/services/llm-turn-guard';
import { LLM_FALLBACK_MAX_MODELS } from '../../common/constants/sales-ops.constants';
import { ConversationEngineService } from './conversation-engine.service';

function makeEngine() {
  const svc = Object.create(
    ConversationEngineService.prototype,
  ) as ConversationEngineService;
  Object.assign(svc, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    logAiCall: jest.fn(),
    logTextCreditUsage: jest.fn(),
  });
  return svc as unknown as {
    tryModelFallbackChain: (
      c: unknown,
      kind: string,
      label: string,
      run: (m: string) => Promise<unknown>,
    ) => Promise<unknown>;
    handleMessageInner: (
      c: unknown,
      t: string,
    ) => Promise<{
      reply: string;
      busy?: boolean;
    }>;
  };
}

describe('2.1 — سقف fallback و اشباع', () => {
  afterEach(() => jest.restoreAllMocks());

  it('زنجیره‌ی fallback حداکثر LLM_FALLBACK_MAX_MODELS مدل را امتحان می‌کند', async () => {
    const engine = makeEngine();
    const run = jest.fn().mockRejectedValue(new Error('down'));
    const out = await engine.tryModelFallbackChain(
      { id: 'c1' },
      'CAPTION',
      'test',
      run,
    );
    expect(out).toBeNull();
    expect(run).toHaveBeenCalledTimes(LLM_FALLBACK_MAX_MODELS);
  });

  it('زنجیره روی اولین موفقیت برمی‌گردد', async () => {
    const engine = makeEngine();
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ result: 'ok', inputTokens: 1, outputTokens: 1 });
    const out = await engine.tryModelFallbackChain(
      { id: 'c1' },
      'CAPTION',
      'test',
      run,
    );
    expect(out).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('در اشباع پاسخ مهربان برمی‌گردد، بدون هیچ write/LLM', async () => {
    jest.spyOn(guard, 'isLlmSaturated').mockReturnValue(true);
    const engine = makeEngine();
    const result = await engine.handleMessageInner(
      { id: 'c1', currentState: 'BROWSING' },
      'سلام',
    );
    expect(result.busy).toBe(true);
    expect(result.reply).toContain('شلوغ');
  });
});
