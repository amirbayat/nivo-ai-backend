import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { AnonChatConfigService } from '../anon-chat-config.service';
import { UpdateAnonChatConfigDto } from '../dto/update-anon-chat-config.dto';

@Controller('admin/anon-chat-config')
@UseGuards(JwtGuard, AdminGuard)
export class AnonChatConfigAdminController {
  constructor(private readonly anonChatConfigService: AnonChatConfigService) {}

  @Get()
  getConfig() {
    return this.anonChatConfigService.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateAnonChatConfigDto) {
    return this.anonChatConfigService.updateConfig(dto);
  }
}
