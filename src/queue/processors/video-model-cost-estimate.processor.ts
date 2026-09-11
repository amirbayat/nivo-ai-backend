import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import {
  VideoJobStatus,
  VideoModelProvider,
  type KieVideoCategory,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseInputFields } from '../../modules/kie-video-models/input-fields.schema';
import {
  resolveEffectiveDurationSec,
  type FieldValues,
} from '../../modules/kie-video-models/generic-payload-builder';

const RECENT_JOB_LIMIT = 50;
const KIE_USD_PER_CREDIT = 0.005;
const MIN_USD_PER_SEC = 0.001;
const MAX_USD_PER_SEC = 5;

@Processor('video-model-cost-estimate')
export class VideoModelCostEstimateProcessor {
  private readonly logger = new Logger(VideoModelCostEstimateProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('estimate')
  async handleEstimate() {
    const models = await this.prisma.kieVideoModel.findMany({
      where: { isActive: true },
    });
    if (!models.length) return;

    const usdByModelId = new Map<string, number>();
    const usdByCategory = new Map<KieVideoCategory, number[]>();

    for (const model of models) {
      try {
        const usd = await this.averageRecentCostPerSecondUsd(model.id, model);
        if (usd == null) continue;
        usdByModelId.set(model.id, usd);
        const list = usdByCategory.get(model.category) ?? [];
        list.push(usd);
        usdByCategory.set(model.category, list);
      } catch (err) {
        this.logger.warn(
          `video estimate failed for model=${model.slug}: ${(err as Error).message}`,
        );
      }
    }

    const categoryAvg = new Map<KieVideoCategory, number>();
    for (const [category, values] of usdByCategory) {
      if (!values.length) continue;
      categoryAvg.set(
        category,
        values.reduce((sum, v) => sum + v, 0) / values.length,
      );
    }

    let updated = 0;
    for (const model of models) {
      const usd =
        usdByModelId.get(model.id) ?? categoryAvg.get(model.category) ?? null;
      if (usd == null) continue;
      await this.prisma.kieVideoModel.update({
        where: { id: model.id },
        data: {
          pricePerSecondUsdConfirmed: usd,
          pricingNote:
            model.pricingNote ??
            `estimated from recent jobs ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      updated++;
    }

    this.logger.log(
      `Video model cost estimate: ${updated} model(s) updated (${usdByModelId.size} from own jobs)`,
    );
  }

  private async averageRecentCostPerSecondUsd(
    modelId: string,
    model: {
      provider: VideoModelProvider;
      inputFields: unknown;
    },
  ): Promise<number | null> {
    const jobs = await this.prisma.videoEditJob.findMany({
      where: {
        kieVideoModelId: modelId,
        status: VideoJobStatus.SUCCEEDED,
        creditsConsumedRaw: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: RECENT_JOB_LIMIT,
      select: {
        creditsConsumedRaw: true,
        valuesJson: true,
        videoWindowStartSec: true,
        videoWindowEndSec: true,
      },
    });
    if (!jobs.length) return null;

    const rates: number[] = [];
    for (const job of jobs) {
      const usd = this.jobCostUsd(model.provider, job.creditsConsumedRaw);
      if (usd == null) continue;
      const durationSec = this.jobDurationSec(model.inputFields, job);
      if (durationSec <= 0) continue;
      const perSec = usd / durationSec;
      if (perSec < MIN_USD_PER_SEC || perSec > MAX_USD_PER_SEC) continue;
      rates.push(perSec);
    }
    if (!rates.length) return null;
    return rates.reduce((sum, v) => sum + v, 0) / rates.length;
  }

  private jobCostUsd(
    provider: VideoModelProvider,
    creditsConsumedRaw: number | null,
  ): number | null {
    if (creditsConsumedRaw == null || creditsConsumedRaw <= 0) return null;
    if (provider === VideoModelProvider.KIE) {
      return creditsConsumedRaw * KIE_USD_PER_CREDIT;
    }
    return creditsConsumedRaw;
  }

  private jobDurationSec(
    inputFields: unknown,
    job: {
      valuesJson: unknown;
      videoWindowStartSec: number | null;
      videoWindowEndSec: number | null;
    },
  ): number {
    if (inputFields) {
      try {
        return resolveEffectiveDurationSec(
          parseInputFields(inputFields),
          (job.valuesJson as FieldValues | null) ?? {},
        );
      } catch {
        // fall through to window / default
      }
    }
    if (job.videoWindowEndSec != null && job.videoWindowStartSec != null) {
      const width = job.videoWindowEndSec - job.videoWindowStartSec;
      if (width > 0) return width;
    }
    return 8;
  }
}
