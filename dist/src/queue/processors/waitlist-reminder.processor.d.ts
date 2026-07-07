import { CampaignService } from '../../modules/campaign/campaign.service';
export declare class WaitlistReminderProcessor {
    private readonly campaign;
    private readonly logger;
    constructor(campaign: CampaignService);
    handle(): Promise<void>;
}
