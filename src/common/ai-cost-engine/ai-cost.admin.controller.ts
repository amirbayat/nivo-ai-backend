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
import { AiCostReportService } from './ai-cost-report.service';
import { BOT_CHANGELOG } from './bot-changelog';
import { ShadowJudgeService } from './shadow/shadow-judge.service';
import { buildLayerReport } from './shadow/shadow-report';
import { getShadow, listShadow, saveShadow, type Verdict } from './shadow/shadow-store';

const isEngine = (v: unknown): v is EngineMode => v === 'stable' || v === 'lean';

// بخش ۲.۴ — endpointهای تب «موتور» و «دفتر تغییرات». همه زیر guard ادمین.
@Controller('admin/ai-cost')
@UseGuards(JwtGuard, AdminGuard)
export class AiCostAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AiCostReportService,
    private readonly judge: ShadowJudgeService,
  ) {}

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

  @Get('cost-report')
  costReport(@Query('days') days?: string) {
    return this.reports.costReport(Number(days) || 7);
  }

  @Get('compare')
  compare(@Query('days') days?: string) {
    return this.reports.compare(Number(days) || 7);
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

  // ACE-12 — گزارش shadow به تفکیک لایه (و باند برای semanticCache)
  @Get('shadow/report')
  async shadowReport() {
    const all = await listShadow(5000);
    return {
      total: all.length,
      pendingJudge: all.filter((s) => !s.judge && !s.human).length,
      layers: [
        buildLayerReport('fastAnswers', all),
        buildLayerReport('productBrief', all),
        buildLayerReport('semanticCache', all, 'exact'),
        buildLayerReport('semanticCache', all, 'high'),
        buildLayerReport('semanticCache', all, 'verified'),
      ],
    };
  }

  // صف بازبینی انسانی: هنوز بازبینی‌نشده‌ها، نیت‌های حساس و اختلاف/wrong اول
  @Get('shadow/queue')
  async shadowQueue(@Query('limit') limit?: string) {
    const all = await listShadow(2000);
    const rank = (s: (typeof all)[number]) => (s.judge?.verdict === 'wrong' ? 0 : s.judge?.verdict === 'worse' ? 1 : 2);
    return all
      .filter((s) => !s.human)
      .sort((a, b) => rank(a) - rank(b) || b.ts - a.ts)
      .slice(0, Math.min(Number(limit) || 30, 100));
  }

  @Post('shadow/review')
  async shadowReview(@Body() body: { id: string; verdict: Verdict; note?: string }, @CurrentUser() admin: JwtPayload) {
    if (!['equal', 'worse', 'wrong'].includes(body.verdict)) throw new BadRequestException('verdict نامعتبر');
    const s = await getShadow(body.id);
    if (!s) throw new BadRequestException('نمونه پیدا نشد (منقضی شده؟)');
    await saveShadow({ ...s, human: { verdict: body.verdict, note: body.note, at: Date.now(), by: admin.sub } });
    return { ok: true };
  }

  @Post('shadow/judge-run')
  async shadowJudgeRun() {
    return this.judge.runBatch();
  }
}
