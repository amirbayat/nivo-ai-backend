import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { GuideAssistantService } from './guide-assistant.service';
import {
  GuideAssistantStreamDto,
  GuideAssistantTtsDto,
} from './dto/guide-assistant.dto';

// docs/PRD-seller-guide-assistant-modal.md بخش ۳.۳ — جایگزین «کپی پرامپت → ChatGPT بیرونی»
// فقط برای store-setup/product؛ knowledge-extraction/bulk-import دست‌نخورده می‌مانند
// (GuidePromptModal قدیمی برای آن دو context هنوز استفاده می‌شود)
@Controller('v2/stores')
@UseGuards(JwtGuard)
export class GuideAssistantController {
  constructor(private readonly guideAssistant: GuideAssistantService) {}

  @Post(':id/guide-assistant/stream')
  stream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: GuideAssistantStreamDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.guideAssistant.streamChat(user.sub, id, dto, req, res);
  }

  @Post(':id/guide-assistant/tts')
  async tts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: GuideAssistantTtsDto,
    @Res() res: Response,
  ) {
    const buffer = await this.guideAssistant.synthesizeSpeech(user.sub, id, dto);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  }
}
