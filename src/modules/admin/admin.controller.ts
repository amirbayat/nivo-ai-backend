import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard()
  }

  @Get('users')
  getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getUsers(page ? Number(page) : 1, limit ? Number(limit) : 20, search)
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: { isActive?: boolean; role?: 'USER' | 'ADMIN' },
  ) {
    return this.adminService.updateUser(id, body)
  }

  @Get('token-stats')
  getTokenStats() {
    return this.adminService.getTokenStats()
  }

  @Get('revenue')
  getRevenue() {
    return this.adminService.getRevenueStats()
  }

  @Get('pricing-alert')
  getPricingAlert() {
    return this.adminService.getPricingAlert()
  }

  @Get('cost-chart')
  getCostChart(@Query('days') days?: string) {
    return this.adminService.getCostChart(days ? Number(days) : 30)
  }

  @Post('users/:id/limit')
  setLimit(
    @Param('id') id: string,
    @Body() body: { type: 'daily' | '1h' | '3h' | '6h'; reason?: string },
  ) {
    return this.adminService.setManualLimit(id, body.type, body.reason)
  }

  @Delete('users/:id/limit')
  removeLimit(@Param('id') id: string) {
    return this.adminService.removeManualLimit(id)
  }

  @Get('users/:id/limit')
  getLimit(@Param('id') id: string) {
    return this.adminService.getManualLimit(id)
  }

  @Patch('users/:id/plan')
  changePlan(@Param('id') id: string, @Body() body: { planId: string }) {
    return this.adminService.changeUserPlan(id, body.planId)
  }
}
