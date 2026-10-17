import { runWithAceTurn } from './ace-context';
import { applyPromptCache, PROMPT_CACHE_BREAK as B } from './prompt-cache';

const sys = `rules${B}\nstore${B}\ncatalog${B}\ndynamic`;
const mk = (model: string, content: unknown = sys) => ({ model, messages: [{ role: 'system', content }, { role: 'user', content: 'hi' }] });

describe('applyPromptCache', () => {
  it('anthropic: parts با cache_control روی سه بلوک اول و بدون sentinel', () => {
    const out = applyPromptCache(mk('anthropic/claude-sonnet-5.5')) as any;
    const parts = out.messages[0].content;
    expect(parts.map((p: any) => p.text)).toEqual(['rules', 'store', 'catalog', 'dynamic']);
    expect(parts.map((p: any) => !!p.cache_control)).toEqual([true, true, true, false]);
    expect(JSON.stringify(out)).not.toContain(B);
  });

  it('غیر anthropic: فقط sentinel حذف می‌شود و cache_control نیست', () => {
    const out = applyPromptCache(mk('openai/gpt-6-luna')) as any;
    expect(typeof out.messages[0].content).toBe('string');
    expect(JSON.stringify(out)).not.toContain(B);
    expect(JSON.stringify(out)).not.toContain('cache_control');
  });

  it('بدون sentinel: همان آبجکت (مسیر پایدار دست‌نخورده)', () => {
    const body = mk('anthropic/claude-sonnet-5.5', 'plain prompt');
    expect(applyPromptCache(body)).toBe(body);
  });

  it('session_id از context گفتگو', () => {
    runWithAceTurn(() => {
      expect((applyPromptCache(mk('x-ai/grok-4.7')) as any).session_id).toBe('conv-1');
    }, { conversationId: 'conv-1' });
  });
});
