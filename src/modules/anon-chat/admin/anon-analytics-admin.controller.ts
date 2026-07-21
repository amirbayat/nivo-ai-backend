import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../../common/guards/jwt.guard'
import { AdminGuard } from '../../../common/guards/admin.guard'
import { AnonAnalyticsService } from './anon-analytics.service'

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function parseRange(from?: string, to?: string) {
  let toDate = to ? new Date(to) : new Date()
  if (to && DATE_ONLY_RE.test(to)) {
    toDate = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1)
  }
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from: fromDate, to: toDate }
}

@Controller('admin/anon-analytics')
@UseGuards(JwtGuard, AdminGuard)
export class AnonAnalyticsAdminController {
  constructor(private readonly analytics: AnonAnalyticsService) {}

  @Get('overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.overview(f, t)
  }

  @Get('timeseries')
  timeseries(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.timeseries(f, t)
  }

  @Get('sessions')
  sessions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('utmSource') utmSource?: string,
    @Query('utmCampaign') utmCampaign?: string,
  ) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.sessions(f, t, Number(page) || 1, Number(pageSize) || 20, { utmSource, utmCampaign })
  }

  @Get('sessions/conversations/:conversationId/messages')
  getConversationMessages(@Param('conversationId') conversationId: string) {
    return this.analytics.getSessionConversationMessages(conversationId)
  }

  @Get('funnel')
  funnel(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('utmSource') utmSource?: string,
    @Query('utmCampaign') utmCampaign?: string,
  ) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.funnel(f, t, { utmSource, utmCampaign })
  }

  @Get('conversion-paths')
  conversionPaths(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('utmSource') utmSource?: string,
    @Query('utmCampaign') utmCampaign?: string,
  ) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.conversionPaths(f, t, { utmSource, utmCampaign })
  }

  @Get('campaigns')
  campaigns(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.campaigns(f, t)
  }

  @Get('conversion-quality')
  conversionQuality(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = parseRange(from, to)
    return this.analytics.conversionQuality(f, t)
  }
}
