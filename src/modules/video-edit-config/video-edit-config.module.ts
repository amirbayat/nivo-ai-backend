import { Module } from '@nestjs/common';
import { VideoEditConfigService } from './video-edit-config.service';
import { VideoEditConfigAdminController } from './video-edit-config-admin.controller';

@Module({
  controllers: [VideoEditConfigAdminController],
  providers: [VideoEditConfigService],
  exports: [VideoEditConfigService],
})
export class VideoEditConfigModule {}
