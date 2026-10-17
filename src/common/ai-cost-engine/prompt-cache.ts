import { getAceContext } from './ace-context';

// ACE-2 — sentinel بین بلوک‌های prompt. هرگز نباید به provider برسد.
export const PROMPT_CACHE_BREAK = '⟦CACHE_BREAK⟧';
const MAX_BREAKPOINTS = 4;

type Part = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
type Msg = { role?: string; content?: unknown; [k: string]: unknown };

// body درخواست chat/completions را درجا نمی‌گیرد؛ نسخه‌ی جدید برمی‌گرداند.
// - بدون sentinel در system: body دست‌نخورده (مسیر پایدار هیچ‌وقت sentinel ندارد)
// - anthropic/*: system به content parts شکسته می‌شود و cache_control روی انتهای هر بلوکِ قبل از sentinel می‌نشیند
//   (آخرین بلوک پویا cache نمی‌شود)
// - بقیه: فقط sentinel حذف می‌شود؛ کش prefix خودکار است
// - session_id = conversationId برای sticky routing
export function applyPromptCache(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Msg[] | undefined;
  const first = messages?.[0];
  if (!messages || !first || first.role !== 'system' || typeof first.content !== 'string') return body;
  if (!first.content.includes(PROMPT_CACHE_BREAK)) return body;

  const blocks = first.content.split(PROMPT_CACHE_BREAK).map((b) => b.replace(/^\n+|\n+$/g, ''));
  const isAnthropic = typeof body.model === 'string' && body.model.startsWith('anthropic/');
  let systemMsg: Msg;
  if (isAnthropic) {
    const parts: Part[] = blocks.map((text, i) => ({
      type: 'text',
      text,
      ...(i < blocks.length - 1 && i < MAX_BREAKPOINTS ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    systemMsg = { ...first, content: parts };
  } else {
    systemMsg = { ...first, content: blocks.join('\n\n') };
  }
  const conversationId = getAceContext()?.conversationId;
  return {
    ...body,
    messages: [systemMsg, ...messages.slice(1)],
    ...(conversationId && body.session_id === undefined ? { session_id: conversationId } : {}),
  };
}
