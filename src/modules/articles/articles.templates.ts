import { marked } from 'marked'
import type { Article, ArticleCategory } from '@prisma/client'

// این استایل عمداً جدا از باندل React است (بخش ۳ docs/PRD-articles-seo-blog.md) —
// همون پالت رنگی/فونت فرانت اصلی (slate/emerald، IRANYekanMsn) را دستی تکرار می‌کند
// تا این صفحات هم از نظر برندینگ هماهنگ باشند، بدون این‌که به باندل React وابسته شوند.
const BASE_STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #020617;
    color: #e2e8f0;
    font-family: 'IRANYekanMsn', 'Vazirmatn', Tahoma, system-ui, sans-serif;
    line-height: 1.75;
  }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  header.site {
    border-bottom: 1px solid rgba(51,65,85,0.6);
    padding: 20px 0;
  }
  header.site .row { display: flex; align-items: center; justify-content: space-between; }
  header.site .brand { font-weight: 800; font-size: 20px; color: #f1f5f9; }
  header.site .brand span { color: #34d399; }
  header.site nav a {
    color: #94a3b8; font-size: 14px; margin-inline-start: 20px;
  }
  header.site nav a:hover { color: #e2e8f0; }
  main { padding: 48px 0 80px; }
  .layout { display: grid; grid-template-columns: 1fr 260px; gap: 40px; align-items: start; }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  .categories {
    order: 2;
    border: 1px solid rgba(51,65,85,0.6);
    border-radius: 16px;
    padding: 20px;
    background: rgba(30,41,59,0.4);
  }
  .categories h3 { margin: 0 0 12px; font-size: 13px; color: #64748b; font-weight: 600; }
  .categories ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .categories a {
    display: block; padding: 8px 10px; border-radius: 10px; font-size: 14px; color: #cbd5e1;
  }
  .categories a:hover { background: rgba(255,255,255,0.04); }
  .categories a.active { background: rgba(16,185,129,0.12); color: #34d399; font-weight: 600; }
  .article-list { order: 1; display: flex; flex-direction: column; gap: 16px; }
  .card {
    display: block; border: 1px solid rgba(51,65,85,0.6); border-radius: 18px;
    padding: 20px; background: rgba(30,41,59,0.4); transition: border-color .15s;
  }
  .card:hover { border-color: rgba(100,116,139,0.8); }
  .card .cat { font-size: 12px; color: #34d399; font-weight: 600; margin-bottom: 8px; }
  .card h2 { margin: 0 0 8px; font-size: 19px; color: #f1f5f9; }
  .card p { margin: 0; color: #94a3b8; font-size: 14px; }
  .card time { display: block; margin-top: 12px; color: #64748b; font-size: 12px; }
  .empty { color: #64748b; text-align: center; padding: 60px 0; }
  article.post { max-width: 720px; margin: 0 auto; }
  article.post .cat { font-size: 13px; color: #34d399; font-weight: 600; margin-bottom: 10px; }
  article.post h1 { font-size: 30px; color: #f1f5f9; margin: 0 0 12px; line-height: 1.5; }
  article.post time { color: #64748b; font-size: 13px; }
  article.post .cover { width: 100%; border-radius: 18px; margin: 24px 0; }
  article.post .body { color: #cbd5e1; font-size: 16px; margin-top: 28px; }
  article.post .body h2 { color: #f1f5f9; font-size: 22px; margin-top: 36px; }
  article.post .body h3 { color: #f1f5f9; font-size: 18px; margin-top: 28px; }
  article.post .body a { color: #34d399; text-decoration: underline; }
  article.post .body ul, article.post .body ol { padding-inline-start: 1.4em; }
  article.post .body code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 6px; font-size: 0.9em; }
  article.post .body pre { background: rgba(255,255,255,0.04); padding: 16px; border-radius: 12px; overflow-x: auto; }
  article.post .body blockquote {
    border-inline-start: 3px solid #34d399; margin: 0; padding-inline-start: 16px; color: #94a3b8;
  }
  footer.cta {
    margin-top: 60px; padding: 32px; text-align: center; border-radius: 20px;
    border: 1px solid rgba(16,185,129,0.25); background: rgba(16,185,129,0.06);
  }
  footer.cta h3 { margin: 0 0 8px; font-size: 20px; color: #f1f5f9; }
  footer.cta p { margin: 0; color: #94a3b8; font-size: 14px; line-height: 1.7; }
  footer.cta a {
    display: inline-block; margin-top: 16px; padding: 12px 28px; border-radius: 12px;
    background: #10b981; color: #fff; font-weight: 700; font-size: 14px;
  }
`

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}

interface LayoutOptions {
  title: string
  description: string
  ogImage?: string | null
  canonicalPath: string
  bodyHtml: string
}

function renderLayout({ title, description, ogImage, canonicalPath, bodyHtml }: LayoutOptions): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
  <link rel="canonical" href="${escapeHtml(canonicalPath)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>${BASE_STYLE}</style>
</head>
<body>
  <header class="site">
    <div class="wrap row">
      <a class="brand" href="/">نیو<span>و</span></a>
      <nav>
        <a href="/blog">مقالات</a>
        <a href="/#pricing">پلن‌ها</a>
        <a href="/login">ورود</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    ${bodyHtml}
  </main>
</body>
</html>`
}

export function renderArticleListPage(opts: {
  categories: ArticleCategory[]
  activeCategorySlug?: string
  articles: (Article & { category: ArticleCategory | null })[]
}): string {
  const { categories, activeCategorySlug, articles } = opts

  const categoryLinks = [
    `<li><a href="/blog" class="${!activeCategorySlug ? 'active' : ''}">همه‌ی مقالات</a></li>`,
    ...categories.map(
      c => `<li><a href="/blog?category=${encodeURIComponent(c.slug)}" class="${activeCategorySlug === c.slug ? 'active' : ''}">${escapeHtml(c.name)}</a></li>`,
    ),
  ].join('')

  const cards = articles.length
    ? articles
        .map(
          a => `<a class="card" href="/blog/${encodeURIComponent(a.slug)}">
        ${a.category ? `<div class="cat">${escapeHtml(a.category.name)}</div>` : ''}
        <h2>${escapeHtml(a.title)}</h2>
        <p>${escapeHtml(a.metaDescription ?? '')}</p>
        <time>${a.publishedAt ? formatDate(a.publishedAt) : ''}</time>
      </a>`,
        )
        .join('')
    : `<div class="empty">هنوز مقاله‌ای منتشر نشده.</div>`

  const bodyHtml = `
    <div class="layout">
      <div class="article-list">${cards}</div>
      <aside class="categories">
        <h3>دسته‌بندی‌ها</h3>
        <ul>${categoryLinks}</ul>
      </aside>
    </div>`

  return renderLayout({
    title: 'مقالات نیوو — آموزش و راهنمای هوش مصنوعی',
    description: 'مقالات آموزشی نیوو درباره‌ی هوش مصنوعی، کاربردها، و راهنمای استفاده.',
    canonicalPath: '/blog',
    bodyHtml,
  })
}

export function renderArticlePage(article: Article & { category: ArticleCategory | null }): string {
  const bodyMd = marked.parse(article.contentMd) as string
  const description = article.metaDescription ?? article.contentMd.replace(/[#*_`]/g, '').slice(0, 160)

  const bodyHtml = `
    <article class="post">
      ${article.category ? `<div class="cat">${escapeHtml(article.category.name)}</div>` : ''}
      <h1>${escapeHtml(article.title)}</h1>
      <time>${article.publishedAt ? formatDate(article.publishedAt) : ''}</time>
      ${article.coverImageUrl ? `<img class="cover" src="${escapeHtml(article.coverImageUrl)}" alt="${escapeHtml(article.title)}">` : ''}
      <div class="body">${bodyMd}</div>
      <footer class="cta">
        <h3>نیوو؛ دستیار هوش مصنوعی با دسترسی به جدیدترین مدل‌های دنیا</h3>
        <p>ChatGPT، Claude، Gemini، Grok، DeepSeek و مدل‌های دیگه — با پرداخت ریالی و به‌صرفه، بدون فیلترشکن و بدون کارت بانکی خارجی.</p>
        <a href="/login">شروع رایگان ←</a>
      </footer>
    </article>`

  return renderLayout({
    title: `${article.title} | نیوو`,
    description,
    ogImage: article.coverImageUrl,
    canonicalPath: `/blog/${article.slug}`,
    bodyHtml,
  })
}
