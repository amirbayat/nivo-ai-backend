import { Module } from '@nestjs/common'
import { ImageGenerationService } from './image-generation.service'

// ماژول مشترک — تا ChatModule و DiscoveryModule (فیچر جدید دیسکاوری/نیوو) هر دو بدون کپی کد
// و بدون وابستگی سنگین به کل ChatModule (Redis/ModelRouter/UsageAnalytics/...) بتوانند تولید
// عکس را صدا بزنند.
@Module({
  providers: [ImageGenerationService],
  exports: [ImageGenerationService],
})
export class ImageGenerationModule {}
