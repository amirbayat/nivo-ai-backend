import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { SalesAdminService } from './sales-admin.service'
import { UpdateSalesBotConfigDto, UpdateLeadFollowUpDto, SendLeadSmsDto } from './dto/sales-admin.dto'
import {
  BulkImportSalesKbDto,
  CreateSalesKbEntryDto,
  TestRetrievalDto,
  UpdateSalesKbEntryDto,
} from './dto/sales-kb.dto'

@Controller('admin/sales-bot')
@UseGuards(JwtGuard, AdminGuard)
export class SalesAdminController {
  constructor(private readonly salesAdminService: SalesAdminService) {}

  @Get('config')
  getConfig() {
    return this.salesAdminService.getConfig()
  }

  @Patch('config')
  updateConfig(@Body() dto: UpdateSalesBotConfigDto) {
    return this.salesAdminService.updateConfig(dto)
  }

  @Get('analytics/overview')
  getAnalyticsOverview(@Query('from') from: string, @Query('to') to: string) {
    return this.salesAdminService.getAnalyticsOverview(from, to)
  }

  @Get('analytics/timeseries')
  getAnalyticsTimeseries(@Query('from') from: string, @Query('to') to: string) {
    return this.salesAdminService.getAnalyticsTimeseries(from, to)
  }

  @Get('leads')
  getLeads(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.salesAdminService.getLeads(page ? Number(page) : 1, limit ? Number(limit) : 20, status)
  }

  @Patch('leads/:id')
  updateLeadFollowUp(@Param('id') id: string, @Body() dto: UpdateLeadFollowUpDto) {
    return this.salesAdminService.updateLeadFollowUp(id, dto.followUpStatus)
  }

  @Post('leads/:id/sms')
  sendLeadSms(@Param('id') id: string, @Body() dto: SendLeadSmsDto) {
    return this.salesAdminService.sendLeadSms(id, dto.message)
  }

  // ─── پایگاه دانش (RAG) — docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۱۰ ──
  @Get('kb')
  listKbEntries(@Query('kind') kind?: string) {
    return this.salesAdminService.listKbEntries(kind)
  }

  @Post('kb')
  createKbEntry(@Body() dto: CreateSalesKbEntryDto) {
    return this.salesAdminService.createKbEntry(dto)
  }

  @Patch('kb/:id')
  updateKbEntry(@Param('id') id: string, @Body() dto: UpdateSalesKbEntryDto) {
    return this.salesAdminService.updateKbEntry(id, dto)
  }

  @Delete('kb/:id')
  deleteKbEntry(@Param('id') id: string) {
    return this.salesAdminService.deleteKbEntry(id)
  }

  @Post('kb/bulk-import')
  bulkImportKb(@Body() dto: BulkImportSalesKbDto) {
    return this.salesAdminService.bulkImportKbEntries(dto.entries)
  }

  @Post('kb/test-retrieval')
  testKbRetrieval(@Body() dto: TestRetrievalDto) {
    return this.salesAdminService.testKbRetrieval(dto.sampleMessage)
  }
}
