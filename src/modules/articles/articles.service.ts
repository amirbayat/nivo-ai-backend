import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { renderArticleListPage, renderArticlePage } from './articles.templates'
import type { CreateArticleDto, UpdateArticleDto } from './dto/article.dto'
import type { CreateArticleCategoryDto, UpdateArticleCategoryDto } from './dto/article-category.dto'

function slugify(input: string): string {
  return input
    .trim()
    .replace(/[«»"'!؟?.,:؛;()[\]{}]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100)
}

/**
 * سیستم مقالات برای SEO — docs/PRD-articles-seo-blog.md.
 * صفحات عمومی (/blog، /blog/:slug) به‌جای React، مستقیم اینجا به HTML رندر می‌شوند
 * (بخش ۳ سند) تا از همان درخواست اول title/meta/OG درست داشته باشند.
 */
@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── صفحات عمومی (HTML) ────────────────────────────────────────────────────
  async renderListPage(categorySlug?: string): Promise<string> {
    const [categories, articles] = await Promise.all([
      this.prisma.articleCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.article.findMany({
        where: {
          status: 'PUBLISHED',
          ...(categorySlug ? { category: { slug: categorySlug } } : {}),
        },
        include: { category: true },
        orderBy: { publishedAt: 'desc' },
      }),
    ])
    return renderArticleListPage({ categories, activeCategorySlug: categorySlug, articles })
  }

  async renderSingleArticlePage(slug: string): Promise<string> {
    const article = await this.prisma.article.findUnique({ where: { slug }, include: { category: true } })
    if (!article || article.status !== 'PUBLISHED') throw new NotFoundException('مقاله پیدا نشد')
    return renderArticlePage(article)
  }

  // ─── برای ردیف تبلیغاتی فرانت (JSON سبک) ───────────────────────────────────
  async getPinned(): Promise<{ slug: string; title: string } | null> {
    const article = await this.prisma.article.findFirst({
      where: { status: 'PUBLISHED', isPinnedInBanner: true },
      select: { slug: true, title: true },
    })
    return article ?? null
  }

  // ─── ادمین: دسته‌بندی‌ها ────────────────────────────────────────────────────
  listCategories() {
    return this.prisma.articleCategory.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  async createCategory(dto: CreateArticleCategoryDto) {
    const slug = await this.uniqueCategorySlug(dto.slug || dto.name)
    return this.prisma.articleCategory.create({
      data: {
        name: dto.name,
        slug,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    })
  }

  async updateCategory(id: string, dto: UpdateArticleCategoryDto) {
    const data: Record<string, unknown> = { ...dto }
    if (dto.slug) data.slug = await this.uniqueCategorySlug(dto.slug, id)
    return this.prisma.articleCategory.update({ where: { id }, data })
  }

  async deleteCategory(id: string) {
    await this.prisma.articleCategory.delete({ where: { id } })
  }

  // ─── ادمین: مقالات ──────────────────────────────────────────────────────────
  listArticles() {
    return this.prisma.article.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createArticle(dto: CreateArticleDto) {
    const slug = await this.uniqueArticleSlug(dto.slug || dto.title)
    const status = dto.status ?? 'DRAFT'

    if (dto.isPinnedInBanner) await this.unpinAll()

    return this.prisma.article.create({
      data: {
        slug,
        title: dto.title,
        metaDescription: dto.metaDescription,
        coverImageUrl: dto.coverImageUrl,
        contentMd: dto.contentMd,
        categoryId: dto.categoryId,
        status,
        isPinnedInBanner: dto.isPinnedInBanner ?? false,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    })
  }

  async updateArticle(id: string, dto: UpdateArticleDto) {
    const existing = await this.prisma.article.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('مقاله پیدا نشد')

    const data: Record<string, unknown> = { ...dto }
    if (dto.slug) data.slug = await this.uniqueArticleSlug(dto.slug, id)
    if (dto.isPinnedInBanner) await this.unpinAll()

    // اولین باری که وضعیت به PUBLISHED می‌رود، تاریخ انتشار ثبت می‌شود (بعد از آن دست‌نخورده می‌ماند)
    if (dto.status === 'PUBLISHED' && !existing.publishedAt) data.publishedAt = new Date()

    return this.prisma.article.update({ where: { id }, data })
  }

  async deleteArticle(id: string) {
    await this.prisma.article.delete({ where: { id } })
  }

  private async unpinAll(): Promise<void> {
    await this.prisma.article.updateMany({ where: { isPinnedInBanner: true }, data: { isPinnedInBanner: false } })
  }

  private async uniqueArticleSlug(base: string, excludeId?: string): Promise<string> {
    const root = slugify(base)
    let candidate = root
    let n = 2
    for (;;) {
      const existing = await this.prisma.article.findUnique({ where: { slug: candidate } })
      if (!existing || existing.id === excludeId) return candidate
      candidate = `${root}-${n++}`
    }
  }

  private async uniqueCategorySlug(base: string, excludeId?: string): Promise<string> {
    const root = slugify(base)
    let candidate = root
    let n = 2
    for (;;) {
      const existing = await this.prisma.articleCategory.findUnique({ where: { slug: candidate } })
      if (!existing || existing.id === excludeId) return candidate
      candidate = `${root}-${n++}`
    }
  }
}
