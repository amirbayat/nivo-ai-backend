// docs/PRD-sales-agent-sales-state-machine.md §۱۰.۴ — نوبت‌های واقعی user/assistant به‌جای
// transcript داخل system. خالص؛ شکل خروجی ساختاری با ModelMessage کتابخانه‌ی ai سازگار است
export type HistoryEntry = { role: 'user' | 'assistant'; text: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function buildChatMessages(
  history: HistoryEntry[],
  currentText: string,
): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const h of history) {
    const text = h.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === h.role) {
      // بعضی providerها alternation می‌خواهند
      last.content = `${last.content}\n${text}`;
    } else {
      merged.push({ role: h.role, content: text });
    }
  }
  // پیام اول باید user باشد
  while (merged.length && merged[0].role === 'assistant') merged.shift();
  const last = merged[merged.length - 1];
  if (last && last.role === 'user') {
    last.content = `${last.content}\n${currentText}`;
  } else {
    merged.push({ role: 'user', content: currentText });
  }
  return merged;
}
