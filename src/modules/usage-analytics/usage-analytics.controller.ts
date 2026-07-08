import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { UsageAnalyticsService, parseDateRange } from './usage-analytics.service'
import { TopicService } from './topic.service'

@Controller('admin/analytics')
@UseGuards(JwtGuard, AdminGuard)
export class UsageAnalyticsController {
  constructor(
    private readonly analytics: UsageAnalyticsService,
    private readonly topics: TopicService,
  ) {}

  @Get('overview')
  getOverview(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compareTo') compareTo?: string,
  ) {
    return this.analytics.getOverview(parseDateRange(from, to), compareTo === 'previous_period')
  }

  @Get('timeseries')
  getTimeseries(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    return this.analytics.getTimeseries(parseDateRange(from, to), granularity ?? 'day')
  }

  @Get('models')
  getModels(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.getModelBreakdown(parseDateRange(from, to))
  }

  @Get('topics')
  getTopicsBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.getTopicBreakdown(parseDateRange(from, to))
  }

  @Get('limit-hits')
  getLimitHits(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.getLimitHits(parseDateRange(from, to))
  }

  @Get('users')
  getUsers(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('segment') segment?: string,
  ) {
    return this.analytics.getUsers(parseDateRange(from, to), segment)
  }

  @Get('users/:userId/models')
  getUserModelBreakdown(
    @Param('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getUserModelBreakdown(userId, parseDateRange(from, to))
  }

  @Get('users/export')
  async exportUsers(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('segment') segment?: string,
  ) {
    const csv = await this.analytics.exportUsersCsv(parseDateRange(from, to), segment)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="usage-analytics.csv"')
    res.send('﻿' + csv) // BOM برای بازشدن درست فارسی در اکسل
  }

  @Get('segments')
  listSegments() {
    return this.analytics.listSegments()
  }

  @Get('segments/breakdown')
  getSegmentBreakdown(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compareTo') compareTo?: string,
  ) {
    return this.analytics.getSegmentBreakdown(parseDateRange(from, to), compareTo === 'previous_period')
  }

  @Post('segments')
  createSegment(@Body() body: {
    label: string
    minMessagesPerDay?: number | null
    maxMessagesPerDay?: number | null
    minTokensPerDay?: number | null
    maxTokensPerDay?: number | null
    color?: string | null
    sortOrder?: number
    isActive?: boolean
  }) {
    return this.analytics.createSegment(body as never)
  }

  @Patch('segments/:id')
  updateSegment(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.analytics.updateSegment(id, body as never)
  }

  @Delete('segments/:id')
  deleteSegment(@Param('id') id: string) {
    return this.analytics.deleteSegment(id)
  }
}

@Controller('admin/topics')
@UseGuards(JwtGuard, AdminGuard)
export class TopicController {
  constructor(private readonly topics: TopicService) {}

  @Get()
  list() {
    return this.topics.list()
  }

  @Post()
  create(@Body() body: { name: string; keywords: string[]; color?: string; sortOrder?: number }) {
    return this.topics.create(body)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.topics.update(id, body as never)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.topics.remove(id)
  }
}
