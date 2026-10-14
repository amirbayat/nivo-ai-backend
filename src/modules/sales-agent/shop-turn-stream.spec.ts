import {
  closeShopTurn,
  extractRespondText,
  isInsideShopTurn,
  listenShopTurn,
  openShopTurn,
  runOutsideShopTurn,
  runWithShopTurn,
  type ShopTurnEvent,
} from './shop-turn-stream';

describe('extractRespondText', () => {
  it('reads a partial JSON string before the closing quote', () => {
    expect(extractRespondText('{"text":"سلام')).toBe('سلام');
  });

  it('keeps escaped newlines', () => {
    expect(extractRespondText('{"text":"سلام\\nحتماً"')).toBe('سلام\nحتماً');
  });

  it('returns null before the text field starts', () => {
    expect(extractRespondText('{"quickReplies"')).toBeNull();
  });
});

describe('shop turn buffer [F9/F27]', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('close wakes the listener and keeps events past the original deadline', async () => {
    jest.useFakeTimers();
    const sink = openShopTurn('t-close', () => {});
    sink.emit({ type: 'status', text: 'a' });
    const collected: string[] = [];
    const task = (async () => {
      for await (const event of listenShopTurn('t-close')) {
        if (event.type === 'status') collected.push(event.text);
      }
    })();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    closeShopTurn('t-close');
    await task;
    expect(collected).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(2_000);
    const late: ShopTurnEvent[] = [];
    for await (const event of listenShopTurn('t-close')) late.push(event);
    expect(late.some((event) => event.type === 'status')).toBe(true);
    closeShopTurn('t-close');
  });

  it('drops an unclosed buffer after 120s', async () => {
    jest.useFakeTimers();
    openShopTurn('t-expire', () => {});
    await jest.advanceTimersByTimeAsync(120_000);
    const late: ShopTurnEvent[] = [];
    for await (const event of listenShopTurn('t-expire')) late.push(event);
    expect(late).toEqual([]);
  });

  it('round-trips a done event that is queued', async () => {
    const sink = openShopTurn('t-queued', () => {});
    sink.emit({
      type: 'done',
      reply: '',
      uiBlocks: [],
      state: 'BROWSING',
      awaitingReview: false,
      queued: true,
    });
    closeShopTurn('t-queued');
    const events: ShopTurnEvent[] = [];
    for await (const event of listenShopTurn('t-queued')) events.push(event);
    expect(events[0]).toMatchObject({ type: 'done', queued: true });
    closeShopTurn('t-queued');
  });

  it('runs follow-up work outside the stream sink', async () => {
    const sink = openShopTurn('t-out', () => {});
    const seen: boolean[] = [];
    await runWithShopTurn(sink, async () => {
      seen.push(isInsideShopTurn());
      await runOutsideShopTurn(async () => {
        seen.push(isInsideShopTurn());
      });
      seen.push(isInsideShopTurn());
    });
    closeShopTurn('t-out');
    expect(seen).toEqual([true, false, true]);
  });
});
