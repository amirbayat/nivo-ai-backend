import { MessageFeedbackService } from '../../modules/message-feedback/message-feedback.service';
export declare class ModelFeedbackSummaryProcessor {
    private readonly messageFeedbackService;
    private readonly logger;
    constructor(messageFeedbackService: MessageFeedbackService);
    handleSummarize(): Promise<void>;
}
