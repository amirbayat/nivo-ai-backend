import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { ArticlesService } from './articles.service'
import { CreateArticleDto, UpdateArticleDto } from './dto/article.dto'
import { CreateArticleCategoryDto, UpdateArticleCategoryDto } from './dto/article-category.dto'

@Controller('admin/articles')
@UseGuards(JwtGuard, AdminGuard)
export class ArticlesAdminController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  list() {
    return this.articlesService.listArticles()
  }

  @Post()
  create(@Body() dto: CreateArticleDto) {
    return this.articlesService.createArticle(dto)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.articlesService.updateArticle(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.articlesService.deleteArticle(id)
  }
}

@Controller('admin/article-categories')
@UseGuards(JwtGuard, AdminGuard)
export class ArticleCategoriesAdminController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  list() {
    return this.articlesService.listCategories()
  }

  @Post()
  create(@Body() dto: CreateArticleCategoryDto) {
    return this.articlesService.createCategory(dto)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateArticleCategoryDto) {
    return this.articlesService.updateCategory(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.articlesService.deleteCategory(id)
  }
}
