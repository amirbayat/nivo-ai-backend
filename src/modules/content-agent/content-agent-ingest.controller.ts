import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ContentAgentService } from './content-agent.service';
import { CreateAgentArticleDto } from './dto/create-agent-article.dto';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';

// docs/PRD-daily-content-prompt-agent.md بخش ۵ — از سیستم کاربر (Claude Code) با X-Api-Key
// صدا زده می‌شود، نه از مرورگر؛ پس پشت ApiKeyGuard است، نه JwtGuard/AdminGuard.
@Controller('content-agent')
@UseGuards(ApiKeyGuard)
export class ContentAgentIngestController {
  constructor(private readonly contentAgentService: ContentAgentService) {}

  @Post('articles')
  createArticle(@Body() dto: CreateAgentArticleDto) {
    return this.contentAgentService.createAgentArticle(dto);
  }

  @Post('prompts')
  createPrompt(@Body() dto: CreateAgentPromptDto) {
    return this.contentAgentService.createAgentPrompt(dto);
  }
}
