import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PricingGenerationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../../modules/usage/pricing.service';
import { PricingTiersService } from '../../modules/usage/pricing-tiers.service';

// docs/PRD-image-gen-pricing-and-credit-fix.md بخش D — «~N نیوو» روی دکمه‌ی تولید عکس. منبع عدد:
// میانگین خودکار هزینه‌ی واقعی مصرف اخیر (نه یک فیلد دستی که ادمین ست کند). فقط برای *نمایش*
// پیش از تولید استفاده می‌شود — بخش ۲.۴/۷ پلن: هیچ‌وقت نباید preflight بک‌اند بر پایه‌ی این عدد
// gate/قفل بسازد.
const RECENT_MESSAGE_WINDOW_DAYS = 7;
const RECENT_MESSAGE_LIMIT = 50;

@Processor('image-model-cost-estimate')
export class ImageModelCostEstimateProcessor {
  private readonly logger = new Logger(ImageModelCostEstimateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly pricingTiers: PricingTiersService,
  ) {}

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
        const costToman = model.imageGenFlatPriceUnit
          ? (await this.pricing.calcImageGenFlatCost(model)).costToman
          : await this.averageRecentCostToman(model.name);

        if (costToman === null) {
          await this.prisma.aiModel.update({
            where: { id: model.id },
            data: { estimatedImageGenCreditCost: null },
          });
          clearedForNoData++;
          continue;
        }

        const markup = await this.pricingTiers.getMarkup(
          PricingGenerationType.IMAGE,
          costToman,
        );
        const estimatedImageGenCreditCost = await this.pricing.tomanToCredits(
          costToman,
          markup,
        );
        await this.prisma.aiModel.update({
          where: { id: model.id },
          data: { estimatedImageGenCreditCost },
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

  // مدل‌های token-based (imageGenFlatPriceUnit=null) — میانگین هزینه‌ی واقعی همون چیزیه که
  // debitWallet واقعاً کسر کرده: openrouterRealCostToman (هزینه‌ی واقعی OpenRouter)، fallback به
  // costToman تخمینی وقتی OpenRouter آن‌بار cost برنگردانده (یا روی لیارا که همیشه null است).
  // اول createdAt فیلتر می‌شود (بازه‌ی ۷ روزه) چون Message.model ایندکس ندارد — بدون این فیلتر
  // کوئری روی کل تاریخچه‌ی پیام‌ها سنگین می‌شد.
  private async averageRecentCostToman(modelName: string): Promise<number | null> {
    const since = new Date(
      Date.now() - RECENT_MESSAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const messages = await this.prisma.message.findMany({
      where: { model: modelName, role: 'ASSISTANT', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGE_LIMIT,
      select: { costToman: true, openrouterRealCostToman: true },
    });
    if (!messages.length) return null;

    const total = messages.reduce(
      (sum, m) => sum + (m.openrouterRealCostToman ?? m.costToman),
      0,
    );
    return Math.ceil(total / messages.length);
  }
}
