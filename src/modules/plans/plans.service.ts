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
        ...(dto.maxInputTokens !== undefined && { maxInputTokens: dto.maxInputTokens }),
        ...(dto.outputThrottleSteps !== undefined && {
          outputThrottleSteps: dto.outputThrottleSteps as Prisma.InputJsonValue,
        }),
        ...(dto.throttledMessageCount !== undefined && { throttledMessageCount: dto.throttledMessageCount ?? null }),
        ...(dto.throttledInputTokens !== undefined && { throttledInputTokens: dto.throttledInputTokens ?? null }),
        ...(dto.throttledOutputTokens !== undefined && { throttledOutputTokens: dto.throttledOutputTokens ?? null }),
      },
    })
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id)
    const { features, outputThrottleSteps, ...rest } = dto
    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...rest,
        ...(features !== undefined && { features: features as Prisma.InputJsonValue }),
        ...(outputThrottleSteps !== undefined && {
          outputThrottleSteps: outputThrottleSteps as Prisma.InputJsonValue,
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
    // clear every cached plan so they pick up the new limits on next request
    if (updated.priceMonthly === 0) {
      const keys = await this.redis.keys('plan:*')
      keys.forEach(k => delTasks.push(this.redis.del(k)))
    }

    if (delTasks.length) await Promise.all(delTasks)
    return updated
  }

  async remove(id: string) {
    await this.findOne(id)
    return this.prisma.plan.delete({ where: { id } })
  }
}
