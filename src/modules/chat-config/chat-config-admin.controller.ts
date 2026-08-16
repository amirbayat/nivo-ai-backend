import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ChatConfigService } from './chat-config.service';
import { UpdateChatConfigDto } from './dto/update-chat-config.dto';

@Controller('admin/chat-config')
@UseGuards(JwtGuard, AdminGuard)
export class ChatConfigAdminController {
  constructor(private readonly chatConfigService: ChatConfigService) {}

  @Get()
  getConfig() {
    return this.chatConfigService.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateChatConfigDto) {
    return this.chatConfigService.updateConfig(dto);
  }
}
