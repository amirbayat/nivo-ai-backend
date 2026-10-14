import { toEnglishDigits } from '../../common/utils/normalize-digits';

export function variantComboKey(optionValues: unknown): string {
  if (!optionValues || typeof optionValues !== 'object' || Array.isArray(optionValues)) {
    return '[]';
  }
  const pairs = Object.entries(optionValues as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(pairs);
}

export function planVariantSync(
  existing: { id: string; optionValues: unknown }[],
  incoming: { optionValues: Record<string, string> }[],
): { updates: { id: string; index: number }[]; creates: number[]; deleteIds: string[] } {
  const byKey = new Map<string, string>();
  for (const row of existing) {
    const key = variantComboKey(row.optionValues);
    if (!byKey.has(key)) byKey.set(key, row.id);
  }
  const updates: { id: string; index: number }[] = [];
  const creates: number[] = [];
  const keep = new Set<string>();
  incoming.forEach((row, index) => {
    const id = byKey.get(variantComboKey(row.optionValues));
    if (id) {
      updates.push({ id, index });
      keep.add(id);
    } else {
      creates.push(index);
    }
  });
  return {
    updates,
    creates,
    deleteIds: existing.filter((row) => !keep.has(row.id)).map((row) => row.id),
  };
}

export function parseImportNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const cleaned = toEnglishDigits(String(value))
    .replace(/تومان/g, '')
    .replace(/[,٬\s]/g, '')
    .trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

export function csvEscape(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
