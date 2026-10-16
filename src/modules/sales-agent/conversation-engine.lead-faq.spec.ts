import { ConversationEngineService } from './conversation-engine.service';

// [QA-8] فروشگاه لید: جست‌وجوی FAQ نباید بعد از miss باکس دانش، فراخوان LLM جدای پروفایل فروشگاه بزند
describe('findFaqAnswer skipStoreProfileLlm [QA-8]', () => {
  function build(kbMatch: unknown) {
    const svc = Object.create(ConversationEngineService.prototype) as unknown as {
      findFaqAnswer: (c: unknown, ctx: unknown, q: string, o?: { skipStoreProfileLlm?: boolean }) => Promise<unknown>;
    };
    const tryAnswerFromStoreProfile = jest.fn().mockResolvedValue('پاسخ بازنویسی‌شده');
    Object.assign(svc, {
      storeKb: { retrieveRelevant: jest.fn().mockResolvedValue(kbMatch) },
      tryAnswerFromProductDescriptions: jest.fn().mockResolvedValue(null),
      tryAnswerFromStoreProfile,
      logTextCreditUsage: jest.fn(),
    });
    return { svc, tryAnswerFromStoreProfile };
  }
  const conv = { storeId: 's1' };

  it('با skip و miss باکس دانش: null و بدون فراخوان LLM پروفایل', async () => {
    const { svc, tryAnswerFromStoreProfile } = build(null);
    await expect(svc.findFaqAnswer(conv, {}, 'q', { skipStoreProfileLlm: true })).resolves.toBeNull();
    expect(tryAnswerFromStoreProfile).not.toHaveBeenCalled();
  });

  it('بدون skip رفتار قبلی حفظ می‌شود', async () => {
    const { svc, tryAnswerFromStoreProfile } = build(null);
    await expect(svc.findFaqAnswer(conv, {}, 'q')).resolves.toEqual({
      source: 'STORE_PROFILE',
      fact: 'پاسخ بازنویسی‌شده',
    });
    expect(tryAnswerFromStoreProfile).toHaveBeenCalledTimes(1);
  });

  it('hit باکس دانش با skip هم برمی‌گردد', async () => {
    const { svc } = build({ question: 'a', answer: 'b' });
    await expect(svc.findFaqAnswer(conv, {}, 'q', { skipStoreProfileLlm: true })).resolves.toMatchObject({ source: 'STORE_KB' });
  });
});
