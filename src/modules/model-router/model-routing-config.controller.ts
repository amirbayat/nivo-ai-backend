import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { PrismaService } from '../../prisma/prisma.service'
import { ModelRouterService } from './model-router.service'
import { UpdateRoutingConfigDto } from './dto/update-routing-config.dto'

const SINGLETON_ID = 'singleton'

function toUpdateData(dto: UpdateRoutingConfigDto) {
  const { simpleKeywords, complexKeywords, ...rest } = dto
  return {
    ...rest,
    ...(simpleKeywords !== undefined && {
      simpleKeywords: simpleKeywords as Prisma.InputJsonValue,
    }),
    ...(complexKeywords !== undefined && {
      complexKeywords: complexKeywords as Prisma.InputJsonValue,
    }),
  }
}

@Controller('admin/model-routing-config')
@UseGuards(JwtGuard, AdminGuard)
export class ModelRoutingConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  @Get()
  async get() {
    const config = await this.prisma.modelRoutingConfig.findFirst()
    return (
      config ??
      this.prisma.modelRoutingConfig.create({ data: { id: SINGLETON_ID } })
    )
  }

  @Patch()
  async update(@Body() dto: UpdateRoutingConfigDto) {
    const data = toUpdateData(dto)
    const existing = await this.prisma.modelRoutingConfig.findFirst()
    const updated = existing
      ? await this.prisma.modelRoutingConfig.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.modelRoutingConfig.create({
          data: { id: SINGLETON_ID, ...data },
        })

    await this.modelRouter.invalidateConfigCache()
    return updated
  }
}
