import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { ArticlesController } from './articles.controller'
import { ArticlesAdminController, ArticleCategoriesAdminController } from './articles-admin.controller'
import { ArticlesService } from './articles.service'

@Module({
  imports: [PrismaModule],
  controllers: [ArticlesController, ArticlesAdminController, ArticleCategoriesAdminController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
