import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { CampaignService } from '../../modules/campaign/campaign.service'

@Processor('waitlist-reminder')
export class WaitlistReminderProcessor {
  private readonly logger = new Logger(WaitlistReminderProcessor.name)

  constructor(private readonly campaign: CampaignService) {}

  @Process('send-reminders')
  async handle() {
    await this.campaign.sendDueReminders()
    this.logger.log('Waitlist reminder pass completed')
  }
}
