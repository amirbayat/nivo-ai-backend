import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ContentAgentApiKeysService } from './content-agent-api-keys.service';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

// docs/PRD-daily-content-prompt-agent.md بخش ۴ — صفحه‌ی ادمین /admin/content-agent/api-keys
@Controller('admin/content-agent/api-keys')
@UseGuards(JwtGuard, AdminGuard)
export class ContentAgentApiKeysController {
  constructor(private readonly apiKeysService: ContentAgentApiKeysService) {}

  @Get()
  list() {
    return this.apiKeysService.list();
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    return this.apiKeysService.update(id, dto);
  }
}
