import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { AnonChatController } from './anon-chat.controller'
import { AnonChatService } from './anon-chat.service'
import { AnonChatConfigService } from './anon-chat-config.service'
import { AnonIdentityService } from './anon-identity.service'
import { AnonFunnelEventService } from './anon-funnel-event.service'
import { AnonMigrationService } from './anon-migration.service'
import { AnonChatConfigAdminController } from './admin/anon-chat-config-admin.controller'
import { AnonAnalyticsService } from './admin/anon-analytics.service'
import { AnonAnalyticsAdminController } from './admin/anon-analytics-admin.controller'

@Module({
  imports: [UsageModule],
  controllers: [AnonChatController, AnonChatConfigAdminController, AnonAnalyticsAdminController],
  providers: [
    AnonChatService,
    AnonChatConfigService,
    AnonIdentityService,
    AnonFunnelEventService,
    AnonMigrationService,
    AnonAnalyticsService,
  ],
  // AnonMigrationService توسط AuthModule صدا زده می‌شود (migration-on-login)
  // AnonIdentityService توسط DiscoveryModule صدا زده می‌شود (امتحان رایگان استودیو محتوا برای مهمان)
  exports: [AnonMigrationService, AnonIdentityService],
})
export class AnonChatModule {}
