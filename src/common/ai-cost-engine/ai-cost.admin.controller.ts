import { BadRequestException, Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { AdminGuard } from '../guards/admin.guard';
import { JwtGuard } from '../guards/jwt.guard';
import { PrismaService } from '../../prisma/prisma.service';
import type { AceSettingsPatch, EngineMode } from './ace-config';
import {
  emergencyRevertToStable,
  getAceSettings,
  undoEmergencyRevert,
  updateAceSettings,
} from './ace-config';
import { BOT_CHANGELOG } from './bot-changelog';

const isEngine = (v: unknown): v is EngineMode => v === 'stable' || v === 'lean';

// بخش ۲.۴ — endpointهای تب «موتور» و «دفتر تغییرات». همه زیر guard ادمین.
@Controller('admin/ai-cost')
@UseGuards(JwtGuard, AdminGuard)
export class AiCostAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('settings')
  async settings() {
    const s = await getAceSettings();
    const ids = Object.keys(s.storeOverrides);
    const stores = ids.length
      ? await this.prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } })
      : [];
    return {
      ...s,
      overrides: ids.map((id) => ({ storeId: id, mode: s.storeOverrides[id], store: stores.find((x) => x.id === id) ?? null })),
      lastChange: s.audit[0] ?? null,
    };
  }

  @Patch('settings')
  async update(@Body() body: AceSettingsPatch, @CurrentUser() admin: JwtPayload) {
    if (body.engineMode !== undefined && !isEngine(body.engineMode)) throw new BadRequestException('engineMode نامعتبر');
    if (body.storeOverride) {
      const { storeId, mode } = body.storeOverride;
      if (typeof storeId !== 'string' || !storeId) throw new BadRequestException('storeId لازم است');
      if (mode !== null && !isEngine(mode)) throw new BadRequestException('mode نامعتبر');
    }
    await updateAceSettings(
      { engineMode: body.engineMode, layers: body.layers, params: body.params, storeOverride: body.storeOverride },
      admin.sub,
    );
    return this.settings();
  }

  @Post('emergency-revert')
  async revert(@CurrentUser() admin: JwtPayload) {
    await emergencyRevertToStable(admin.sub);
    return this.settings();
  }

  @Post('undo-emergency-revert')
  async undo(@CurrentUser() admin: JwtPayload) {
    const ok = await undoEmergencyRevert(admin.sub);
    if (!ok) throw new BadRequestException('برگرداندن فوری‌ای برای لغو پیدا نشد');
    return this.settings();
  }

  @Get('changelog')
  changelog() {
    return BOT_CHANGELOG;
  }

  // جست‌وجوی فروشگاه برای «افزودن استثنا»
  @Get('stores')
  searchStores(@Query('q') q?: string) {
    const term = (q ?? '').trim();
    return this.prisma.store.findMany({
      where: term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { slug: { contains: term, mode: 'insensitive' } }] } : {},
      select: { id: true, name: true, slug: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
  }
}
