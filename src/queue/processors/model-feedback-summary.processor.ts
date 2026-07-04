import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { MessageFeedbackService } from '../../modules/message-feedback/message-feedback.service'

@Processor('model-feedback-summary')
export class ModelFeedbackSummaryProcessor {
  private readonly logger = new Logger(ModelFeedbackSummaryProcessor.name)

  constructor(
    private readonly messageFeedbackService: MessageFeedbackService,
  ) {}

  @Process('summarize')
  async handleSummarize() {
    const result = await this.messageFeedbackService.runSummary()
    this.logger.log(`Model feedback summary run: ${JSON.stringify(result)}`)
  }
}
