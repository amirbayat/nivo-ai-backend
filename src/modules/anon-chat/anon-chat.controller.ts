import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AnonIdentityService } from './anon-identity.service';
import { AnonChatService } from './anon-chat.service';
import { AnonFunnelEventService } from './anon-funnel-event.service';
import { InitAnonSessionDto } from './dto/init-anon-session.dto';
import { AnonStreamMessageDto } from './dto/anon-stream-message.dto';

// عمداً بدون Guard — این کنترلر برای کاربران بدون لاگین است. مالکیت/محدودیت از طریق هدر
// X-Anon-Session-Id + IP کنترل می‌شود (AnonIdentityService.resolveContext).
@Controller('anon-chat')
export class AnonChatController {
  constructor(
    private readonly identityService: AnonIdentityService,
    private readonly anonChatService: AnonChatService,
    private readonly funnelEvents: AnonFunnelEventService,
  ) {}

  @Post('session')
  async initSession(
    @Headers('x-anon-session-id') clientToken: string,
    @Body() dto: InitAnonSessionDto,
    @Req() req: Request,
  ) {
    const context = await this.identityService.initSession(
      getClientIp(req),
      clientToken,
      dto,
    );
    return this.anonChatService.getStatus(context);
  }

  @Get('status')
  async getStatus(
    @Headers('x-anon-session-id') clientToken: string,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.anonChatService.getStatus(context);
  }

  @Post('conversations')
  async createConversation(
    @Headers('x-anon-session-id') clientToken: string,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.anonChatService.createConversation(context);
  }

  @Get('conversations/:id')
  async getConversation(
    @Headers('x-anon-session-id') clientToken: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.anonChatService.getConversation(context, id);
  }

  @Post(':conversationId/stream')
  async stream(
    @Headers('x-anon-session-id') clientToken: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: AnonStreamMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.anonChatService.streamChat(context, conversationId, dto, res);
  }

  @Post('events/cta-click')
  async trackCtaClick(
    @Headers('x-anon-session-id') clientToken: string,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    await this.funnelEvents.emit(context.session.id, 'CLICKED_SIGNUP_CTA');
    return { ok: true };
  }
}

// همان الگوی دقیق sales.controller.ts — این کنترلر هم عمداً public است و IP را همین‌جا
// استخراج می‌کند؛ سایر call siteهای موجود (sales, app-throttler.guard) دست‌نخورده می‌مانند
function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown'
  );
}
