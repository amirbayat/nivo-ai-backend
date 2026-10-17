import { createHash } from 'crypto';
import { splitSections } from './section-splitter';

// با هر تغییر prompt/اعتبارسنجی برگه بالا ببر تا برگه‌ها دوباره ساخته شوند
export const BRIEF_PROMPT_VERSION = 'v1';

export function briefInputHash(p: {
  name: string; description: string | null; specs: unknown; options: { name: string; values: string[] }[];
}): string {
  const { text } = splitSections(p.description);
  return createHash('sha1')
    .update(JSON.stringify([p.name, text, p.specs ?? null, p.options, BRIEF_PROMPT_VERSION]))
    .digest('hex');
}
