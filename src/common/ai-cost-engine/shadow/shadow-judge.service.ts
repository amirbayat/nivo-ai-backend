import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { generateObject } from 'ai';
import { z } from 'zod';
import { AiProviderService } from '../../services/ai-provider.service';
import { PERCEPTION_MODEL } from '../../../modules/sales-agent/model-variants';
import { runWithAceTurn, setCallSite } from '../ace-context';
import { aceRuntime } from '../ace-runtime';
import { pickForJudging } from './shadow-report';
import { getShadow, listShadow, saveShadow, type ShadowSample, type Verdict } from './shadow-store';

const DAILY_JUDGE_CAP = 200;
const INTERVAL_MS = 6 * 3600 * 1000;
const verdictSchema = z.object({ verdict: z.enum(['equal', 'worse', 'wrong']), reason: z.string() });

const SYSTEM = `تو داور کیفیت جواب دستیار فروش یک فروشگاه هستی.
پیام مشتری، جواب A (جواب واقعی ارسال‌شده) و جواب B (کاندید) را می‌بینی.
بپرس: آیا B به‌اندازه‌ی A درست، کامل و بدون اطلاعات غلط است و به‌اندازه‌ی A فروشنده‌وار و ترغیب‌کننده؟
- equal: B همان‌قدر خوب است (تفاوت فقط در عبارت‌بندی).
- worse: B درست است ولی ناقص‌تر، خشک‌تر یا کمتر کمک‌کننده است.
- wrong: B اطلاعات غلط/متناقض با A (قیمت، موجودی، سایز، شرایط) دارد، یا به سؤال جواب نمی‌دهد.
reason: یک جمله‌ی کوتاه فارسی.`;

@Injectable()
export class ShadowJudgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShadowJudgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly provider;

  constructor(private readonly aiProvider: AiProviderService) {
    this.provider = this.aiProvider.buildClient(undefined, { supportsStructuredOutputs: true });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runBatch(DAILY_JUDGE_CAP).catch(() => undefined), INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async withinDailyCap(): Promise<boolean> {
    try {
      const redis = aceRuntime().redis;
      if (!redis) return false;
      const key = `ace:shadow:judge:${new Date().toISOString().slice(0, 10)}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 36 * 3600);
      return n <= DAILY_JUDGE_CAP;
    } catch {
      return false;
    }
  }

  // یک نمونه را داوری می‌کند؛ خطا → null (نمونه pending می‌ماند)
  async judgeOne(s: ShadowSample): Promise<{ verdict: Verdict; reason: string } | null> {
    try {
      return await runWithAceTurn(async () => {
        setCallSite('shadow_judge');
        const { object } = await generateObject({
          model: this.provider(PERCEPTION_MODEL),
          schema: verdictSchema,
          system: SYSTEM,
          temperature: 0,
          prompt: `پیام مشتری: ${s.customerMessage}\n\nجواب A (واقعی):\n${s.realText}\n\nجواب B (کاندید):\n${s.candidateText}`,
        });
        return object;
      });
    } catch (err) {
      this.logger.warn(`shadow judge failed: ${(err as Error).message}`);
      return null;
    }
  }

  async runBatch(limit = DAILY_JUDGE_CAP): Promise<{ judged: number; skippedByCap: boolean }> {
    const lock = await aceRuntime().redis?.set('ace:shadow:judge:lock', '1', 'EX', 600, 'NX').catch(() => null);
    if (!lock) return { judged: 0, skippedByCap: false };
    const picked = pickForJudging(await listShadow(2000), limit);
    let judged = 0;
    for (const p of picked) {
      if (!(await this.withinDailyCap())) return { judged, skippedByCap: true };
      const fresh = await getShadow(p.id);
      if (!fresh || fresh.judge) continue;
      const v = await this.judgeOne(fresh);
      if (!v) continue;
      await saveShadow({ ...fresh, judge: { ...v, at: Date.now() } });
      judged++;
    }
    return { judged, skippedByCap: false };
  }
}
