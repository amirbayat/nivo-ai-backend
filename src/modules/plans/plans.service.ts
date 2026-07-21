import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { fa } from '../../i18n/fa'
import { CreatePlanDto } from './dto/create-plan.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  findAll() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
  }

  findAllAdmin() {
    return this.prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
    })
  }

  // فقط فیلدهای عمومی/غیرحساس — بدون قیمت — برای ساخت آیکون/توضیح مدل در فرانت (دراپ‌داون چت، کارت پلن‌ها)
  // CHAT + IMAGE_GEN چون این کاتالوگ عمومی است — مدل‌های embedding نباید به کاربر نهایی به‌عنوان
  // گزینه نمایش داده شوند (docs/PRD-sales-kb-rag-and-plan-context.md بخش الف)، اما مدل‌های IMAGE_GEN
  // باید اینجا باشند تا حالت «تولید عکس» فرانت (بر اساس supportsImageGen) آن‌ها را ببیند —
  // مسیریاب مدل (model-router.service.ts) جدا و همچنان فقط modelType:'CHAT' فیلتر می‌کند.
  findModelCatalog() {
    return this.prisma.aiModel.findMany({
      where: { isActive: true, modelType: { in: ['CHAT', 'IMAGE_GEN'] } },
      orderBy: { sortOrder: 'asc' },
      select: {
        name: true,
        displayName: true,
        provider: true,
        modelType: true,
        tier: true,
        supportsVision: true,
        supportsImageGen: true,
        sortOrder: true,
      },
    })
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } })
    if (!plan) throw new NotFoundException(fa.plans.notFound)
    return plan
  }

  create(dto: CreatePlanDto) {
    return this.prisma.plan.create({
      data: {
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        dailyFreeTokens: dto.dailyFreeTokens,
        monthlyTotalTokens: dto.monthlyTotalTokens,
        allowedModels: dto.allowedModels,
        features: (dto.features ?? {}) as Prisma.InputJsonValue,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        dailyMessageLimit: dto.dailyMessageLimit ?? null,
        ...(dto.isPopular !== undefined && { isPopular: dto.isPopular }),
        ...(dto.featuredModels !== undefined && { featuredModels: dto.featuredModels as Prisma.InputJsonValue }),
        ...(dto.featuredModelsCount !== undefined && { featuredModelsCount: dto.featuredModelsCount }),
        ...(dto.maxInputTokens !== undefined && { maxInputTokens: dto.maxInputTokens }),
        ...(dto.outputThrottleSteps !== undefined && {
          outputThrottleSteps: dto.outputThrottleSteps as Prisma.InputJsonValue,
        }),
        ...(dto.throttledMessageCount !== undefined && { throttledMessageCount: dto.throttledMessageCount ?? null }),
        ...(dto.throttledInputTokens !== undefined && { throttledInputTokens: dto.throttledInputTokens ?? null }),
        ...(dto.throttledOutputTokens !== undefined && { throttledOutputTokens: dto.throttledOutputTokens ?? null }),
        ...(dto.rollingWindowLimit !== undefined && { rollingWindowLimit: dto.rollingWindowLimit ?? null }),
        ...(dto.rollingWindowHours !== undefined && { rollingWindowHours: dto.rollingWindowHours }),
        ...(dto.contextMd !== undefined && { contextMd: dto.contextMd }),
        ...(dto.reasoningEffort !== undefined && { reasoningEffort: dto.reasoningEffort ?? null }),
        ...(dto.fastReasoningEffort !== undefined && { fastReasoningEffort: dto.fastReasoningEffort ?? null }),
        ...(dto.smartReasoningEffort !== undefined && { smartReasoningEffort: dto.smartReasoningEffort ?? null }),
        ...(dto.trialMessageThreshold !== undefined && { trialMessageThreshold: dto.trialMessageThreshold ?? null }),
        ...(dto.trialDailyMessageLimit !== undefined && { trialDailyMessageLimit: dto.trialDailyMessageLimit ?? null }),
        ...(dto.trialThrottledMessageCount !== undefined && {
          trialThrottledMessageCount: dto.trialThrottledMessageCount ?? null,
        }),
        ...(dto.trialRollingWindowLimit !== undefined && {
          trialRollingWindowLimit: dto.trialRollingWindowLimit ?? null,
        }),
        ...(dto.trialRollingWindowHours !== undefined && {
          trialRollingWindowHours: dto.trialRollingWindowHours ?? null,
        }),
        ...(dto.isPayAsYouGo !== undefined && { isPayAsYouGo: dto.isPayAsYouGo }),
        ...(dto.payAsYouGoMarkup !== undefined && { payAsYouGoMarkup: dto.payAsYouGoMarkup }),
        ...(dto.payAsYouGoMinActivationToman !== undefined && {
          payAsYouGoMinActivationToman: dto.payAsYouGoMinActivationToman,
        }),
        ...(dto.payAsYouGoMinTopupToman !== undefined && {
          payAsYouGoMinTopupToman: dto.payAsYouGoMinTopupToman,
        }),
        ...(dto.payAsYouGoTopupPresets !== undefined && {
          payAsYouGoTopupPresets: dto.payAsYouGoTopupPresets as Prisma.InputJsonValue,
        }),
        ...(dto.defaultImageGenModel !== undefined && { defaultImageGenModel: dto.defaultImageGenModel }),
        ...(dto.maxImageGenPerDay !== undefined && { maxImageGenPerDay: dto.maxImageGenPerDay }),
        ...(dto.maxImageGenPerWindow !== undefined && { maxImageGenPerWindow: dto.maxImageGenPerWindow }),
        ...(dto.imageGenWindowHours !== undefined && { imageGenWindowHours: dto.imageGenWindowHours }),
      },
    })
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id)
    const { features, outputThrottleSteps, featuredModels, payAsYouGoTopupPresets, ...rest } = dto
    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...rest,
        ...(features !== undefined && { features: features as Prisma.InputJsonValue }),
        ...(outputThrottleSteps !== undefined && {
          outputThrottleSteps: outputThrottleSteps as Prisma.InputJsonValue,
        }),
        ...(featuredModels !== undefined && { featuredModels: featuredModels as Prisma.InputJsonValue }),
        ...(payAsYouGoTopupPresets !== undefined && {
          payAsYouGoTopupPresets: payAsYouGoTopupPresets as Prisma.InputJsonValue,
        }),
      },
    })
    // invalidate Redis plan cache for every subscriber
    const subs = await this.prisma.subscription.findMany({
      where: { planId: id },
      select: { userId: true },
    })
    const delTasks: Promise<unknown>[] = subs.map(s => this.redis.del(`plan:${s.userId}`))

    // free plans (priceMonthly=0) apply to users without subscriptions too —
    // clear every cached plan so they pick up the new limits on next request.
    // scanStream (نه KEYS) — docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۴: KEYS کل فضای کلید
    // Redis را پیمایش می‌کند و در این مدت Redis (تک‌رشته‌ای) به هیچ درخواست دیگری جواب نمی‌دهد
    if (updated.priceMonthly === 0) {
      const keys = await this.scanKeys('plan:*')
      keys.forEach(k => delTasks.push(this.redis.del(k)))
    }

    if (delTasks.length) await Promise.all(delTasks)
    return updated
  }

  private scanKeys(pattern: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = []
      const stream = this.redis.scanStream({ match: pattern, count: 100 })
      stream.on('data', (batch: string[]) => keys.push(...batch))
      stream.on('end', () => resolve(keys))
      stream.on('error', reject)
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    return this.prisma.plan.delete({ where: { id } })
  }
}
