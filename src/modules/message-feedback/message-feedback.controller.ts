import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator'
import { MessageFeedbackService } from './message-feedback.service'
import { SubmitMessageFeedbackDto } from './dto/submit-feedback.dto'

@Controller()
export class MessageFeedbackController {
  constructor(
    private readonly messageFeedbackService: MessageFeedbackService,
  ) {}

  @Post('messages/:id/feedback')
  @UseGuards(JwtGuard)
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SubmitMessageFeedbackDto,
  ) {
    return this.messageFeedbackService.submit(user.sub, id, dto)
  }

  @Get('admin/model-feedback')
  @UseGuards(JwtGuard, AdminGuard)
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('model') model?: string,
    @Query('vote') vote?: string,
  ) {
    const voteFilter = vote === 'UP' || vote === 'DOWN' ? vote : undefined
    return this.messageFeedbackService.getAll(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      model,
      voteFilter,
    )
  }

  @Get('admin/model-feedback/summary')
  @UseGuards(JwtGuard, AdminGuard)
  getSummary() {
    return this.messageFeedbackService.getSummary()
  }

  @Post('admin/model-feedback/trigger')
  @UseGuards(JwtGuard, AdminGuard)
  triggerSummary() {
    return this.messageFeedbackService.triggerSummary()
  }
}
