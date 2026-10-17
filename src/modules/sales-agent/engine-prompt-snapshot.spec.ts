import { ConversationEngineService } from './conversation-engine.service';
import { PROMPT_CACHE_BREAK } from '../../common/ai-cost-engine/prompt-cache';

// ۱.۵ بند ۲ — snapshot پایه‌ی prompt موتور «پایدار». این snapshot فقط با تأیید صریح کاربر آپدیت می‌شود
// (jest -u ممنوع). تغییر ندادنِ آن ثابت می‌کند buildFullAgentSystemPrompt بایت‌به‌بایت همان است.
type Builder = (...a: unknown[]) => Promise<string>;
const mkEngine = () => {
  const eng = Object.create(ConversationEngineService.prototype) as Record<string, unknown>;
  eng.buildStoreProfileText = async () => 'حوزه‌ی فعالیت: پوشاک\nارسال: ۳ روزه';
  eng.cartTotal = (cart: Array<{ price?: number; qty: number }>) => cart.reduce((s, i) => s + (i.price ?? 100) * i.qty, 0);
  return eng as unknown as { buildFullAgentSystemPrompt: Builder; buildFullAgentSystemPromptLean: Builder };
};
const conv = (category = 'fashion') => ({ id: 'c1', storeId: 's1', store: { category } });
const emptyCtx = { cart: [] };
const fullCtx = {
  cart: [{ name: 'مانتو', qty: 2, price: 500000 }],
  lastShownProducts: [{ name: 'مانتو' }],
  customerState: { pain: 'سایز', painSolvable: 'YES', empathyShown: true, attentionCaptured: true, stage: 'PITCHED' },
};
const urgent = { code: 'OFF10', expiresAt: new Date('2026-10-20T10:00:00Z') };

const fixtures: Array<[string, unknown[]]> = [
  ['سبد خالی', [conv(), emptyCtx, 'کاتالوگ A', '', false, false, null, false, false]],
  ['سبد پر و state', [conv(), fullCtx, 'کاتالوگ A', 'مشتری: سلام\nبات: سلام', false, false, null, false, false]],
  ['persuasion و تخفیف', [conv(), fullCtx, 'کاتالوگ A', 'x', true, true, urgent, false, false]],
  ['lead only', [conv(), emptyCtx, 'بدون محصول', '', false, false, null, true, true]],
];

describe('موتور پایدار — snapshot prompt [I-9]', () => {
  it.each(fixtures)('%s', async (_n, args) => {
    const out = await mkEngine().buildFullAgentSystemPrompt(...args);
    expect(out).not.toContain(PROMPT_CACHE_BREAK);
    expect(out).toMatchSnapshot();
  });
});

describe('موتور بهینه — prompt بلوک‌بندی [ACE-2]', () => {
  const split = async (args: unknown[]) => (await mkEngine().buildFullAgentSystemPromptLean(...args)).split(PROMPT_CACHE_BREAK);

  it('چهار بلوک؛ بلوک ۱ تا ۳ بین نوبت‌هایی با state پویای متفاوت بایت‌به‌بایت یکی است', async () => {
    const a = await split(fixtures[0][1]);
    const b = await split([conv(), fullCtx, 'کاتالوگ A', 'تاریخچه‌ی جدید', true, false, null, false, false]);
    expect(a).toHaveLength(4);
    expect(b.slice(0, 3)).toEqual(a.slice(0, 3));
    expect(b[3]).not.toEqual(a[3]);
  });

  it('داده‌ی پویا (سبد، تاریخچه، تخفیف زمان‌دار) فقط در بلوک ۴ است', async () => {
    const p = await split(fixtures[2][1]);
    for (const needle of ['مانتو × 2', 'مشتری: سلام', 'OFF10', 'تحلیل خودت']) {
      expect(p.slice(0, 3).join('')).not.toContain(needle);
    }
    expect(p[3]).toContain('OFF10');
    expect(p[3]).toContain('مانتو × 2');
  });

  it('هیچ رقم تاریخ/ساعتِ امروز در بلوک ۱ تا ۳ نیست؛ تغییر فروشگاه فقط بلوک ۲ و ۳ را عوض می‌کند', async () => {
    const a = await split(fixtures[0][1]);
    const b = await split([conv(), emptyCtx, 'کاتالوگ B', '', false, true, null, false, false]);
    expect(b[0]).toEqual(a[0]);
    expect(b[1]).not.toEqual(a[1]);
    expect(b[2]).not.toEqual(a[2]);
  });

  it('قانون‌های ثابت کامل‌اند (هر قانون حیاتی پایدار در lean هم هست)', async () => {
    const stable = await mkEngine().buildFullAgentSystemPrompt(...(fixtures[0][1] as unknown[]));
    const lean = (await split(fixtures[0][1]))[0];
    const rules = stable.slice(stable.indexOf('قوانین حیاتی:'));
    const bullets = rules.split('\n- ').slice(1).map((b) => b.split('\n')[0].trim()).filter((l) => l.length > 15);
    const missing = bullets.filter((l) => !lean.includes(l.slice(0, 40)) && !l.includes('create_order'));
    expect(missing).toEqual([]);
  });
});
