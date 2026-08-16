import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Controller()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('feedback')
  @UseGuards(JwtGuard)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(user.sub, dto);
  }

  @Get('admin/feedback')
  @UseGuards(JwtGuard, AdminGuard)
  getAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.feedbackService.getAll(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('admin/feedback/summary')
  @UseGuards(JwtGuard, AdminGuard)
  getSummary() {
    return this.feedbackService.getSummary();
  }

  @Post('admin/feedback/summary/trigger')
  @UseGuards(JwtGuard, AdminGuard)
  triggerSummary() {
    return this.feedbackService.triggerSummary();
  }
}
