import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { VideoEditConfigService } from './video-edit-config.service';
import { UpdateVideoEditConfigDto } from './dto/update-video-edit-config.dto';

@Controller('admin/video-edit-config')
@UseGuards(JwtGuard, AdminGuard)
export class VideoEditConfigAdminController {
  constructor(
    private readonly videoEditConfigService: VideoEditConfigService,
  ) {}

  @Get()
  getConfig() {
    return this.videoEditConfigService.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateVideoEditConfigDto) {
    return this.videoEditConfigService.updateConfig(dto);
  }
}
