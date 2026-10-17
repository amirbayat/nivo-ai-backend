/* eslint-disable no-console */
// بررسی دستی: شکل واقعی بدنه‌ی AI SDK به fetch (jest نمی‌تواند ai را لود کند چون ESM-only است)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { applyPromptCache, PROMPT_CACHE_BREAK as B } from '../../src/common/ai-cost-engine/prompt-cache';

async function main() {
  let sent: any;
  const client = createOpenAICompatible({
    name: 't', baseURL: 'http://x', apiKey: 'k',
    transformRequestBody: (b: Record<string, unknown>) => applyPromptCache(b),
    fetch: (async (_u: unknown, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: '1', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }) as never,
  });
  await generateText({ model: client('anthropic/claude-sonnet-5.5'), system: `a${B}\nb${B}\nc${B}\nd`, prompt: 'hi', maxRetries: 0 });
  console.log(JSON.stringify(sent.messages[0]).includes(B) ? 'FAIL sentinel leaked' : 'OK no sentinel', JSON.stringify(sent.messages[0]));
}
void main();
