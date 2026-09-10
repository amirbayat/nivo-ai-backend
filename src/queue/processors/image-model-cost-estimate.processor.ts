import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { imageGenFlatCostUsd } from '../../modules/usage/pricing.service';

// docs/PRD-image-gen-usd-estimate.md — store provider USD only. Catalog converts to نیوو
// at read time. Display-only; never used as a preflight gate.
const RECENT_MESSAGE_WINDOW_DAYS = 7;
const RECENT_MESSAGE_LIMIT = 50;

@Processor('image-model-cost-estimate')
export class ImageModelCostEstimateProcessor {
  private readonly logger = new Logger(ImageModelCostEstimateProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('estimate')
  async handleEstimate() {
    const models = await this.prisma.aiModel.findMany({
      where: { supportsImageGen: true, isActive: true },
    });
    if (!models.length) return;

    let updated = 0;
    let clearedForNoData = 0;

    for (const model of models) {
      try {
        const usd = model.imageGenFlatPriceUnit
          ? imageGenFlatCostUsd(model)
          : await this.averageRecentCostUsd(model.name);

        if (usd == null || usd <= 0) {
          await this.prisma.aiModel.update({
            where: { id: model.id },
            data: { estimatedImageGenCostUsd: null },
          });
          clearedForNoData++;
          continue;
        }

        await this.prisma.aiModel.update({
          where: { id: model.id },
          data: { estimatedImageGenCostUsd: usd },
        });
        updated++;
      } catch (err) {
        this.logger.warn(
          `estimate failed for model=${model.name}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Image model cost estimate: ${updated} model(s) updated, ${clearedForNoData} cleared (no recent data)`,
    );
  }

  private async averageRecentCostUsd(modelName: string): Promise<number | null> {
    const since = new Date(
      Date.now() - RECENT_MESSAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const messages = await this.prisma.message.findMany({
      where: { model: modelName, role: 'ASSISTANT', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGE_LIMIT,
      select: { costUsdMicros: true, openrouterRealCostUsdMicros: true },
    });
    if (!messages.length) return null;

    const amounts = messages
      .map((m) => (m.openrouterRealCostUsdMicros ?? m.costUsdMicros) / 1_000_000)
      .filter((usd) => usd > 0);
    if (!amounts.length) return null;

    return amounts.reduce((sum, usd) => sum + usd, 0) / amounts.length;
  }
}
