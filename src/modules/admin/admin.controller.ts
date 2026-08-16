import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { TicketsService } from '../tickets/tickets.service';
import { UpdateTicketStatusDto } from '../tickets/dto/update-ticket-status.dto';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly ticketsService: TicketsService,
  ) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getUsers(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      search,
    );
  }

  // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۵ — نمای جزئیات کاربر (کیف‌پول/تراکنش‌ها/مصرف)
  @Get('users/:id')
  getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: { isActive?: boolean; role?: 'USER' | 'ADMIN' },
  ) {
    return this.adminService.updateUser(id, body);
  }

  @Get('token-stats')
  getTokenStats() {
    return this.adminService.getTokenStats();
  }

  @Get('revenue')
  getRevenue() {
    return this.adminService.getRevenueStats();
  }

  @Get('pricing-alert')
  getPricingAlert() {
    return this.adminService.getPricingAlert();
  }

  @Get('cost-chart')
  getCostChart(@Query('days') days?: string) {
    return this.adminService.getCostChart(days ? Number(days) : 30);
  }

  @Post('users/:id/limit')
  setLimit(
    @Param('id') id: string,
    @Body() body: { type: 'daily' | '1h' | '3h' | '6h'; reason?: string },
  ) {
    return this.adminService.setManualLimit(id, body.type, body.reason);
  }

  @Delete('users/:id/limit')
  removeLimit(@Param('id') id: string) {
    return this.adminService.removeManualLimit(id);
  }

  @Get('users/:id/limit')
  getLimit(@Param('id') id: string) {
    return this.adminService.getManualLimit(id);
  }

  @Patch('users/:id/plan')
  changePlan(@Param('id') id: string, @Body() body: { planId: string }) {
    return this.adminService.changeUserPlan(id, body.planId);
  }

  // docs/PRD-pay-as-you-go-wallet.md — بازگشت وجه دستی + خروج از PAYG
  @Post('users/:id/refund-payg')
  refundPayg(@Param('id') id: string) {
    return this.adminService.refundAndDeactivatePayg(id);
  }

  // ── Tickets ──────────────────────────────────────────────────────────────────

  @Get('tickets')
  getTickets(@Query('status') status?: string) {
    return this.ticketsService.findAll(status);
  }

  @Get('tickets/:id')
  getTicket(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  @Post('tickets/:id/reply')
  addTicketReply(
    @Param('id') id: string,
    @Body() body: { body: string; adminNote?: string },
  ) {
    return this.ticketsService.addAdminReply(id, body.body, body.adminNote);
  }

  @Patch('tickets/:id/status')
  updateTicketStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.ticketsService.updateStatus(
      id,
      dto.status,
      dto.priority,
      dto.adminNote,
    );
  }

  // ── AI Models ───────────────────────────────────────────────────────────────

  @Get('models')
  getModels() {
    return this.adminService.getModels();
  }

  @Post('models')
  createModel(@Body() body: CreateModelDto) {
    return this.adminService.createModel(body);
  }

  @Patch('models/:id')
  updateModel(@Param('id') id: string, @Body() body: UpdateModelDto) {
    return this.adminService.updateModel(id, body);
  }

  @Delete('models/:id')
  deleteModel(@Param('id') id: string) {
    return this.adminService.deleteModel(id);
  }

  @Post('models/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  importModels(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده');
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException(
        'فقط فایل اکسل (.xlsx یا .xls) پذیرفته می‌شود',
      );
    }
    return this.adminService.importModels(file.buffer);
  }
}
