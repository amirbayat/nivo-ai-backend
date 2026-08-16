import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { StreamMessageDto } from './dto/stream-message.dto';

@Controller('chat')
@UseGuards(JwtGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post(':conversationId/stream')
  stream(
    @Param('conversationId') conversationId: string,
    @Body() dto: StreamMessageDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    return this.chatService.streamChat(conversationId, user.sub, dto, res);
  }
}
