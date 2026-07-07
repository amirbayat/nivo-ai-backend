import { Module } from '@nestjs/common'
import { CampaignService } from './campaign.service'
import { CampaignPublicController, WaitlistController, AdminCampaignController } from './campaign.controller'
import { SmsModule } from '../../sms/sms.module'

@Module({
  imports: [SmsModule],
  controllers: [CampaignPublicController, WaitlistController, AdminCampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
