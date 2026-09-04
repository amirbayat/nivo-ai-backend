import { Module } from '@nestjs/common';
import { VideoStudioConfigService } from './video-studio-config.service';
import { VideoStudioConfigAdminController } from './video-studio-config-admin.controller';

@Module({
  controllers: [VideoStudioConfigAdminController],
  providers: [VideoStudioConfigService],
  exports: [VideoStudioConfigService],
})
export class VideoStudioConfigModule {}
