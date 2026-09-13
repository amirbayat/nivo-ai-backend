import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { StreamMessageDto } from './dto/stream-message.dto';
import { CreateImagePromptReviewDto } from './dto/create-image-prompt-review.dto';

@Controller('chat')
@UseGuards(JwtGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // «بررسی پرامپت» استودیوی عکس (docs/PRD-image-prompt-coach.md) — رایگان/بدون کسر کیف‌پول،
  // بدون conversationId (استیت‌لس، دقیقاً مثل video-edit prompt-review)، بدون throttle اضافه
  @Post('prompt-review')
  reviewImagePrompt(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateImagePromptReviewDto,
  ) {
    return this.chatService.reviewImagePrompt(user.sub, dto);
  }

  @Post(':conversationId/stream')
  stream(
    @Param('conversationId') conversationId: string,
    @Body() dto: StreamMessageDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.chatService.streamChat(conversationId, user.sub, dto, req, res);
  }
}
