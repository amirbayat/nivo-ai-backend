import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { VideoStudioConfigService } from './video-studio-config.service';
import { UpdateVideoStudioConfigDto } from './dto/update-video-studio-config.dto';

@Controller('admin/video-studio-config')
@UseGuards(JwtGuard, AdminGuard)
export class VideoStudioConfigAdminController {
  constructor(private readonly videoStudioConfigService: VideoStudioConfigService) {}

  @Get()
  getConfig() {
    return this.videoStudioConfigService.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateVideoStudioConfigDto) {
    return this.videoStudioConfigService.updateConfig(dto);
  }
}
