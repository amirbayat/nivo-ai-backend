import { Module } from '@nestjs/common';
import { KieVideoModelsService } from './kie-video-models.service';
import { KieVideoModelsAdminController } from './kie-video-models-admin.controller';

@Module({
  controllers: [KieVideoModelsAdminController],
  providers: [KieVideoModelsService],
  exports: [KieVideoModelsService],
})
export class KieVideoModelsModule {}
