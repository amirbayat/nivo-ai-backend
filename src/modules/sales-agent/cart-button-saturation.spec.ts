import { ConversationEngineService, isButtonCartAction } from './conversation-engine.service';
import * as limits from '../../common/services/llm-turn-guard';

// docs/PRD-fixes-after-buyer-redesign.md F13 — دکمه‌های سبد وقتی AI اشباع است هم کار می‌کنند
describe('button cart actions skip the LLM saturation gate [FX-3 F13]', () => {
  it('classifies only template cart buttons', () => {
    expect(isButtonCartAction({ type: 'ADD_TO_CART', productId: 'p' })).toBe(true);
    expect(isButtonCartAction({ type: 'SET_CART_QTY', productId: 'p', qty: 2 })).toBe(true);
    expect(isButtonCartAction({ type: 'REMOVE_CART_ITEM', productId: 'p' })).toBe(true);
    expect(isButtonCartAction({ type: 'CONFIRM_CART' })).toBe(false);
    expect(isButtonCartAction({ type: 'ADD_TO_CART' })).toBe(false);
  });

  it('with saturation forced on, a button add still reaches the cart handler', async () => {
    jest.spyOn(limits, 'isLlmSaturated').mockReturnValue(true);
    const eng = Object.create(ConversationEngineService.prototype) as Record<string, any>;
    const done = { reply: 'ok', uiBlocks: [{ type: 'CART_SUMMARY', items: [], total: 0 }], state: 'CART_REVIEW' };
    Object.assign(eng, {
      handleActionTurn: jest.fn().mockResolvedValue(done),
      saturatedResult: jest.fn().mockResolvedValue({ reply: 'busy', uiBlocks: [], state: 'BROWSING' }),
      withTurnReservation: jest.fn(),
    });
    const res = await eng.handleActionInner({ id: 'c' }, { type: 'ADD_TO_CART', productId: 'p' });
    expect(res).toBe(done);
    expect(eng.saturatedResult).not.toHaveBeenCalled();
    expect(eng.withTurnReservation).not.toHaveBeenCalled();
    const typed = await eng.handleActionInner({ id: 'c' }, { type: 'CONFIRM_CART' });
    expect(typed.reply).toBe('busy');
  });
});
