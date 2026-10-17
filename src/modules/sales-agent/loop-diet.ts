import { aceNote } from '../../common/ai-cost-engine/ace-context';

// ACE-6 — بودجه‌ی step حلقه‌ی اصلی (فقط موتور بهینه، لایه‌ی loopDiet).
// جواب نهایی از طریق ابزار respond_to_customer می‌آید، پس به‌جای toolChoice:'none' آن ابزار را اجباری می‌کنیم.
export const LOOP_DIET_FORCE_FROM_STEP = 3; // stepNumber صفرپایه: step چهارم به بعد

type StepLike = { toolCalls?: Array<{ toolName: string; input?: unknown }> };

const sig = (s: StepLike | undefined): string | null => {
  const calls = s?.toolCalls ?? [];
  if (calls.length === 0) return null;
  return calls.map((c) => `${c.toolName}:${JSON.stringify(c.input ?? null)}`).join('|');
};

// هر ابزاری جز respond_to_customer دو step پشت‌سرهم با ورودی یکسان → loop
export function forceReason(stepNumber: number, steps: StepLike[]): string | null {
  if (stepNumber >= LOOP_DIET_FORCE_FROM_STEP)
    return `step ${stepNumber + 1} رسید؛ جواب نهایی اجباری شد (سقف حلقه‌ی ابزار)`;
  if (steps.length >= 2) {
    const a = sig(steps[steps.length - 1]);
    const b = sig(steps[steps.length - 2]);
    if (a && a === b && !a.startsWith('respond_to_customer:'))
      return 'یک ابزار دو بار پشت‌سرهم با ورودی یکسان صدا شد؛ جواب نهایی اجباری شد';
  }
  return null;
}

export const shouldForceFinalAnswer = (stepNumber: number, steps: StepLike[]): boolean =>
  forceReason(stepNumber, steps) !== null;

export function loopDietPrepareStep() {
  return ({ stepNumber, steps }: { stepNumber: number; steps: StepLike[] }) => {
    const why = forceReason(stepNumber, steps);
    if (!why) return undefined;
    aceNote('loopDiet', why, 'full_agent');
    return { toolChoice: { type: 'tool' as const, toolName: 'respond_to_customer' } };
  };
}
