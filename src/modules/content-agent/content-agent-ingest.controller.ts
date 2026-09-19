import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ContentAgentService } from './content-agent.service';
import { CreateAgentArticleDto } from './dto/create-agent-article.dto';
import { CreateAgentImageDto } from './dto/create-agent-image.dto';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';
import { UpdateAgentArticleDto } from './dto/update-agent-article.dto';

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

  @Patch('articles/:slug')
  updateArticle(
    @Param('slug') slug: string,
    @Body() dto: UpdateAgentArticleDto,
  ) {
    return this.contentAgentService.updateAgentArticle(slug, dto);
  }

  @Post('prompts')
  createPrompt(@Body() dto: CreateAgentPromptDto) {
    return this.contentAgentService.createAgentPrompt(dto);
  }

  // میزبانی عکس تولیدشده (مثلاً با GPT Image از طریق OpenRouter، روی سیستم کاربر) برای
  // استفاده در contentMd — سرو عمومی‌اش در content-agent-public.controller.ts (بدون این Guard)
  @Post('images')
  createImage(@Body() dto: CreateAgentImageDto) {
    return this.contentAgentService.createAgentImage(dto);
  }
}
