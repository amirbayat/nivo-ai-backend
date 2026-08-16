import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelRouterService } from '../model-router/model-router.service';
import { UpdatePlanRoutingDto } from './dto/update-plan-routing.dto';
import { REASONING_EFFORT_VALUES } from './reasoning-effort.constants';

@Controller('admin/plans/:id/routing')
@UseGuards(JwtGuard, AdminGuard)
export class PlanRoutingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  @Get()
  async get(@Param('id') id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: { simpleModel: true },
    });
    if (!plan) throw new NotFoundException('پلن یافت نشد');

    const steps = await this.prisma.planRoutingStep.findMany({
      where: { planId: id },
      orderBy: { order: 'asc' },
    });

    return { simpleModel: plan.simpleModel, steps };
  }

  @Put()
  async update(@Param('id') id: string, @Body() dto: UpdatePlanRoutingDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('پلن یافت نشد');

    const allowed = new Set(plan.allowedModels as string[]);
    const sorted = [...dto.steps].sort((a, b) => a.order - b.order);

    sorted.forEach((step, i) => {
      if (i > 0 && step.thresholdPct <= sorted[i - 1].thresholdPct) {
        throw new BadRequestException('سقف مصرف استپ‌ها باید صعودی باشد');
      }
      for (const m of step.models) {
        if (!allowed.has(m)) {
          throw new BadRequestException(
            `مدل «${m}» در مدل‌های مجاز این پلن نیست`,
          );
        }
      }
      if (
        step.reasoningEffort != null &&
        !(REASONING_EFFORT_VALUES as readonly string[]).includes(
          step.reasoningEffort,
        )
      ) {
        throw new BadRequestException(
          `میزان reasoning «${step.reasoningEffort}» نامعتبر است`,
        );
      }
    });

    await this.prisma.$transaction([
      this.prisma.planRoutingStep.deleteMany({ where: { planId: id } }),
      this.prisma.plan.update({
        where: { id },
        data: { simpleModel: dto.simpleModel ?? null },
      }),
      ...sorted.map((step) =>
        this.prisma.planRoutingStep.create({
          data: {
            planId: id,
            order: step.order,
            thresholdPct: step.thresholdPct,
            models: step.models,
            reasoningEffort: step.reasoningEffort ?? null,
          },
        }),
      ),
    ]);

    await this.modelRouter.invalidateStepsCache(id);
    return { message: 'ذخیره شد' };
  }
}
