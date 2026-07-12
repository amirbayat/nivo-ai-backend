import { Controller, Get, Header, Param, Query } from '@nestjs/common'
import { ArticlesService } from './articles.service'

@Controller()
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  // بدون پیشوند api/v1 — آدرس عمومی SEO (docs/PRD-articles-seo-blog.md بخش ۳)
  @Get('blog')
  @Header('Content-Type', 'text/html; charset=utf-8')
  renderList(@Query('category') category?: string) {
    return this.articlesService.renderListPage(category)
  }

  @Get('blog/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  renderArticle(@Param('slug') slug: string) {
    return this.articlesService.renderSingleArticlePage(slug)
  }

  // زیر پیشوند api/v1 عادی — فقط همین را ردیف تبلیغاتی فرانت (React) صدا می‌زند
  @Get('articles/pinned')
  getPinned() {
    return this.articlesService.getPinned()
  }
}
