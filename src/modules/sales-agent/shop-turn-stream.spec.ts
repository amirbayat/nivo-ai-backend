import { extractRespondText } from './shop-turn-stream';

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
