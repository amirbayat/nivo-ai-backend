import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArticlesModule } from '../articles/articles.module';
import { ContentAgentIngestController } from './content-agent-ingest.controller';
import { ContentAgentPublicController } from './content-agent-public.controller';
import { ContentAgentApiKeysController } from './content-agent-api-keys.controller';
import { ContentAgentService } from './content-agent.service';
import { ContentAgentApiKeysService } from './content-agent-api-keys.service';

@Module({
  imports: [PrismaModule, ArticlesModule],
  controllers: [
    ContentAgentIngestController,
    ContentAgentPublicController,
    ContentAgentApiKeysController,
  ],
  providers: [ContentAgentService, ContentAgentApiKeysService],
})
export class ContentAgentModule {}
