import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { LiveStatsService } from './live-stats.service'

@Controller('admin/live-stats')
@UseGuards(JwtGuard, AdminGuard)
export class LiveStatsAdminController {
  constructor(private readonly liveStats: LiveStatsService) {}

  // برای پول کردن مکرر (هر چند ثانیه) از پنل ادمین — سبک نگه داشته شده (بدون timeseries)
  @Get('summary')
  async getSummary() {
    const [activeStreams, today] = await Promise.all([
      this.liveStats.getActiveStreamCount(),
      this.liveStats.getTodayStats(),
    ])
    return { activeStreams, today }
  }

  @Get('timeseries')
  getTimeseries(@Query('minutes') minutes?: string) {
    const parsed = Math.min(Math.max(Number(minutes) || 60, 1), 24 * 60)
    return this.liveStats.getTimeseries(parsed)
  }
}
