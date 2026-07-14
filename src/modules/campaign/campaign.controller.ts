import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { CampaignService } from './campaign.service'

@Controller('campaign')
export class CampaignPublicController {
  constructor(private readonly campaign: CampaignService) {}

  @Get('status')
  getStatus() {
    return this.campaign.getCampaignStatus()
  }
}

@Controller('waitlist')
@UseGuards(JwtGuard)
export class WaitlistController {
  constructor(private readonly campaign: CampaignService) {}

  @Get('me')
  getMyStatus(@CurrentUser() user: JwtPayload) {
    return this.campaign.getMyWaitlistStatus(user.sub)
  }

  @Post('activate')
  activate(@Body('token') token: string) {
    return this.campaign.activateByToken(token)
  }
}

@Controller('admin/campaigns')
@UseGuards(JwtGuard, AdminGuard)
export class AdminCampaignController {
  constructor(private readonly campaign: CampaignService) {}

  @Get()
  list() {
    return this.campaign.listCampaigns()
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.campaign.createCampaign(body as never)
  }

  // مسیر ثابت باید قبل از ':id' بیاید تا با آن اشتباه گرفته نشود
  @Post('grant-phone')
  grantPhone(@Body('phone') phone: string) {
    return this.campaign.grantAccessToPhone(phone)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.campaign.updateCampaign(id, body)
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.campaign.closeCampaign(id)
  }

  @Get(':id/waitlist')
  getWaitlist(@Param('id') id: string, @Query('status') status?: string) {
    return this.campaign.getWaitlist(id, status)
  }

  @Post(':id/grant')
  grant(@Param('id') id: string, @Body('mode') mode: 'all' | number) {
    return this.campaign.grantAccess(id, mode)
  }
}
