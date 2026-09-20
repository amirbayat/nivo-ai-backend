import { marked } from 'marked';
import type { Article, ArticleCategory } from '@prisma/client';

// این استایل عمداً جدا از باندل React است (بخش ۳ docs/PRD-articles-seo-blog.md) —
// همون پالت رنگی/فونت فرانت اصلی (slate/emerald، IRANYekanMsn) را دستی تکرار می‌کند
// تا این صفحات هم از نظر برندینگ هماهنگ باشند، بدون این‌که به باندل React وابسته شوند.
// توکن‌های رنگی زیر پیش‌فرضشان تم روشن است (html[data-theme="dark"] نسخه‌ی تیره‌ی قبلی را
// به‌عنوان آپشن نگه می‌دارد) — تعویض تم با دکمه‌ی هدر و localStorage['nivo:theme'] انجام می‌شود.
const BASE_STYLE = `
  :root {
    --bg: #ffffff;
    --surface: #ffffff;
    --border: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-tertiary: #94a3b8;
    --brand: #059669;
    --brand-soft: #ecfdf5;
    --brand-soft-border: rgba(5,150,105,0.18);
    --code-bg: #f1f5f9;
    --pre-bg: #f8fafc;
    --shadow: 0 1px 2px rgba(15,23,42,0.04);
    --shadow-lg: 0 20px 40px -18px rgba(15,23,42,0.18);
    --hover-tint: rgba(15,23,42,0.04);
  }
  html[data-theme="dark"] {
    --bg: #020617;
    --surface: rgba(30,41,59,0.4);
    --border: rgba(51,65,85,0.6);
    --text-primary: #f1f5f9;
    --text-secondary: #94a3b8;
    --text-tertiary: #64748b;
    --brand: #34d399;
    --brand-soft: rgba(16,185,129,0.12);
    --brand-soft-border: rgba(16,185,129,0.25);
    --code-bg: rgba(255,255,255,0.06);
    --pre-bg: rgba(255,255,255,0.04);
    --shadow: 0 1px 2px rgba(0,0,0,0.3);
    --shadow-lg: 0 20px 40px -18px rgba(0,0,0,0.6);
    --hover-tint: rgba(255,255,255,0.04);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text-secondary);
    font-family: 'IRANYekanMsn', 'Vazirmatn', Tahoma, system-ui, sans-serif;
    line-height: 1.75;
    transition: background-color .2s ease, color .2s ease;
  }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  header.site, .categories, footer.cta, .card, .theme-toggle {
    transition: background-color .2s ease, border-color .2s ease, color .2s ease, transform .2s ease, box-shadow .2s ease;
  }
  header.site { border-bottom: 1px solid var(--border); padding: 20px 0; }
  header.site .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  header.site .brand { font-weight: 800; font-size: 20px; color: var(--text-primary); }
  header.site .brand span { color: var(--brand); }
  header.site .nav-group { display: flex; align-items: center; gap: 20px; }
  header.site nav { display: flex; align-items: center; gap: 20px; }
  header.site nav a { color: var(--text-secondary); font-size: 14px; }
  header.site nav a:hover { color: var(--text-primary); }
  .theme-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 999px; flex-shrink: 0;
    border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary);
    cursor: pointer;
  }
  .theme-toggle:hover { color: var(--brand); border-color: var(--brand-soft-border); }
  html[data-theme="light"] .theme-toggle .icon-sun { display: none; }
  html[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
  main { padding: 48px 0 80px; }
  .layout { display: grid; grid-template-columns: 1fr 260px; gap: 40px; align-items: start; }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  .categories {
    order: 2;
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    background: var(--surface);
  }
  .categories h3 { margin: 0 0 12px; font-size: 13px; color: var(--text-tertiary); font-weight: 600; }
  .categories ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .categories a {
    display: block; padding: 8px 10px; border-radius: 10px; font-size: 14px; color: var(--text-secondary);
  }
  .categories a:hover { background: var(--hover-tint); }
  .categories a.active { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
  .pill {
    display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 12px;
    font-size: 12px; font-weight: 700; background: var(--brand-soft); color: var(--brand);
  }
  .article-list { order: 1; display: flex; flex-direction: column; gap: 28px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  .card {
    display: flex; flex-direction: column; overflow: hidden;
    border: 1px solid var(--border); border-radius: 20px;
    background: var(--surface); box-shadow: var(--shadow);
  }
  .card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: var(--brand-soft-border); }
  .card-cover {
    position: relative; aspect-ratio: 16 / 10; overflow: hidden;
    background: linear-gradient(135deg, var(--brand-soft), var(--surface));
  }
  .card-cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .35s ease; }
  .card:hover .card-cover img { transform: scale(1.05); }
  .card-cover.placeholder { display: flex; align-items: center; justify-content: center; color: var(--brand-soft-border); }
  .card-cover.placeholder svg { width: 34%; height: 34%; }
  .card-cover .pill { position: absolute; inset-block-start: 12px; inset-inline-start: 12px; }
  .card-body { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .card-body h2 { margin: 0; font-size: 17px; color: var(--text-primary); line-height: 1.5; }
  .card-body p {
    margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.6;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .card-meta { margin-top: auto; display: flex; align-items: center; gap: 6px; color: var(--text-tertiary); font-size: 12px; padding-top: 4px; }
  .card-meta .dot { opacity: .6; }
  .hero-card .card-cover { aspect-ratio: 21 / 9; }
  .hero-card .card-body { padding: 24px 28px 28px; gap: 10px; }
  .hero-card h2 { font-size: 26px; }
  @media (max-width: 640px) {
    .hero-card .card-cover { aspect-ratio: 16 / 9; }
    .hero-card h2 { font-size: 20px; }
  }
  .empty { color: var(--text-tertiary); text-align: center; padding: 60px 0; }
  article.post { max-width: 720px; margin: 0 auto; }
  article.post > .pill { margin-bottom: 14px; }
  article.post h1 { font-size: 32px; color: var(--text-primary); margin: 0 0 12px; line-height: 1.45; }
  article.post .meta { display: flex; align-items: center; gap: 6px; color: var(--text-tertiary); font-size: 13px; }
  article.post .meta .dot { opacity: .6; }
  article.post .cover {
    width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 18px; margin: 28px 0; box-shadow: var(--shadow);
  }
  article.post .body { color: var(--text-secondary); font-size: 17px; line-height: 1.9; margin-top: 8px; }
  article.post .body p { margin: 0 0 18px; }
  article.post .body h2 { color: var(--text-primary); font-size: 23px; margin: 40px 0 14px; line-height: 1.5; }
  article.post .body h3 { color: var(--text-primary); font-size: 19px; margin: 30px 0 10px; }
  article.post .body a { color: var(--brand); text-decoration: underline; text-underline-offset: 3px; }
  article.post .body ul, article.post .body ol { padding-inline-start: 1.4em; margin: 0 0 18px; }
  article.post .body li { margin-bottom: 6px; }
  article.post .body img { max-width: 100%; height: auto; border-radius: 14px; display: block; margin: 22px auto; box-shadow: var(--shadow); }
  article.post .body code { background: var(--code-bg); padding: 2px 6px; border-radius: 6px; font-size: 0.9em; }
  article.post .body pre { background: var(--pre-bg); border: 1px solid var(--border); padding: 16px; border-radius: 12px; overflow-x: auto; }
  article.post .body pre code { background: none; padding: 0; }
  article.post .body blockquote {
    border-inline-start: 3px solid var(--brand); margin: 20px 0; padding-inline-start: 16px; color: var(--text-secondary); font-style: italic;
  }
  footer.cta {
    margin-top: 60px; padding: 32px; text-align: center; border-radius: 20px;
    border: 1px solid var(--brand-soft-border); background: var(--brand-soft);
  }
  footer.cta h3 { margin: 0 0 8px; font-size: 20px; color: var(--text-primary); }
  footer.cta p { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.7; }
  footer.cta a {
    display: inline-block; margin-top: 16px; padding: 12px 28px; border-radius: 12px;
    background: #10b981; color: #fff; font-weight: 700; font-size: 14px;
  }
  footer.cta a:hover { background: #059669; }
`;

const THEME_TOGGLE_ICONS = `
  <svg class="icon-sun" viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M10 15a5 5 0 100-10 5 5 0 000 10zM10 0a1 1 0 011 1v1a1 1 0 11-2 0V1a1 1 0 011-1zm0 17a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM3.05 3.05a1 1 0 011.414 0l.707.707A1 1 0 013.757 5.17l-.707-.707a1 1 0 010-1.414zm12.02 12.02a1 1 0 011.414 0l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 010-1.414zM0 10a1 1 0 011-1h1a1 1 0 110 2H1a1 1 0 01-1-1zm17 0a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM3.05 16.95a1 1 0 010-1.414l.707-.707a1 1 0 111.414 1.414l-.707.707a1 1 0 01-1.414 0zm12.02-12.02a1 1 0 010-1.414l.707-.707a1 1 0 111.414 1.414l-.707.707a1 1 0 01-1.414 0z"/>
  </svg>
  <svg class="icon-moon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
  </svg>
`;

const PLACEHOLDER_COVER_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z"/>
  </svg>
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

function estimateReadingMinutes(markdown: string): number {
  const plainText = markdown.replace(/[#*_`>[\]()!-]/g, ' ');
  const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

type ArticleWithCategory = Article & { category: ArticleCategory | null };

function renderCardCover(a: ArticleWithCategory): string {
  const pill = a.category
    ? `<span class="pill">${escapeHtml(a.category.name)}</span>`
    : '';
  if (a.coverImageUrl) {
    return `<div class="card-cover"><img src="${escapeHtml(a.coverImageUrl)}" alt="${escapeHtml(a.title)}" loading="lazy">${pill}</div>`;
  }
  return `<div class="card-cover placeholder">${PLACEHOLDER_COVER_ICON}${pill}</div>`;
}

function renderCardMeta(a: ArticleWithCategory): string {
  const parts: string[] = [];
  if (a.publishedAt) parts.push(`<time>${formatDate(a.publishedAt)}</time>`);
  parts.push(`<span>${estimateReadingMinutes(a.contentMd)} دقیقه مطالعه</span>`);
  return `<div class="card-meta">${parts.join('<span class="dot">·</span>')}</div>`;
}

function renderCard(a: ArticleWithCategory, hero = false): string {
  return `<a class="card${hero ? ' hero-card' : ''}" href="/blog/${encodeURIComponent(a.slug)}">
    ${renderCardCover(a)}
    <div class="card-body">
      <h2>${escapeHtml(a.title)}</h2>
      ${a.metaDescription ? `<p>${escapeHtml(a.metaDescription)}</p>` : ''}
      ${renderCardMeta(a)}
    </div>
  </a>`;
}

interface LayoutOptions {
  title: string;
  description: string;
  ogImage?: string | null;
  canonicalPath: string;
  bodyHtml: string;
}

function renderLayout({
  title,
  description,
  ogImage,
  canonicalPath,
  bodyHtml,
}: LayoutOptions): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="UTF-8">
  <script>
    (function () {
      try {
        var t = localStorage.getItem('nivo:theme');
        document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>
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
      <div class="nav-group">
        <nav>
          <a href="/blog">مقالات</a>
          <a href="/#pricing">پلن‌ها</a>
          <a href="/login">ورود</a>
        </nav>
        <button id="theme-toggle" class="theme-toggle" type="button" aria-label="تغییر تم">${THEME_TOGGLE_ICONS}</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    ${bodyHtml}
  </main>
  <script>
    (function () {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var html = document.documentElement;
        var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        try { localStorage.setItem('nivo:theme', next); } catch (e) {}
      });
    })();
  </script>
</body>
</html>`;
}

export function renderArticleListPage(opts: {
  categories: ArticleCategory[];
  activeCategorySlug?: string;
  articles: ArticleWithCategory[];
}): string {
  const { categories, activeCategorySlug, articles } = opts;

  const categoryLinks = [
    `<li><a href="/blog" class="${!activeCategorySlug ? 'active' : ''}">همه‌ی مقالات</a></li>`,
    ...categories.map(
      (c) =>
        `<li><a href="/blog?category=${encodeURIComponent(c.slug)}" class="${activeCategorySlug === c.slug ? 'active' : ''}">${escapeHtml(c.name)}</a></li>`,
    ),
  ].join('');

  // کارت هیرو فقط در نمای «همه‌ی مقالات» (بدون فیلتر دسته‌بندی) نشان داده می‌شود تا هم در
  // نتایج فیلترشده یک مقاله‌ی نامرتبط بزرگ نمایش داده نشود.
  const heroArticle = !activeCategorySlug
    ? articles.find((a) => a.isPinnedInBanner)
    : undefined;
  const restArticles = heroArticle
    ? articles.filter((a) => a.id !== heroArticle.id)
    : articles;

  const gridHtml = restArticles.length
    ? `<div class="grid">${restArticles.map((a) => renderCard(a)).join('')}</div>`
    : heroArticle
      ? ''
      : `<div class="empty">هنوز مقاله‌ای منتشر نشده.</div>`;

  const bodyHtml = `
    <div class="layout">
      <div class="article-list">
        ${heroArticle ? renderCard(heroArticle, true) : ''}
        ${gridHtml}
      </div>
      <aside class="categories">
        <h3>دسته‌بندی‌ها</h3>
        <ul>${categoryLinks}</ul>
      </aside>
    </div>`;

  return renderLayout({
    title: 'مقالات نیوو — آموزش و راهنمای هوش مصنوعی',
    description:
      'مقالات آموزشی نیوو درباره‌ی هوش مصنوعی، کاربردها، و راهنمای استفاده.',
    canonicalPath: '/blog',
    bodyHtml,
  });
}

export function renderArticlePage(article: ArticleWithCategory): string {
  const bodyMd = marked.parse(article.contentMd) as string;
  const description =
    article.metaDescription ??
    article.contentMd.replace(/[#*_`]/g, '').slice(0, 160);
  const readingMinutes = estimateReadingMinutes(article.contentMd);

  const bodyHtml = `
    <article class="post">
      ${article.category ? `<span class="pill">${escapeHtml(article.category.name)}</span>` : ''}
      <h1>${escapeHtml(article.title)}</h1>
      <div class="meta">
        ${article.publishedAt ? `<time>${formatDate(article.publishedAt)}</time><span class="dot">·</span>` : ''}
        <span>${readingMinutes} دقیقه مطالعه</span>
      </div>
      ${article.coverImageUrl ? `<img class="cover" src="${escapeHtml(article.coverImageUrl)}" alt="${escapeHtml(article.title)}" loading="lazy">` : ''}
      <div class="body">${bodyMd}</div>
      <footer class="cta">
        <h3>نیوو؛ دستیار هوش مصنوعی با دسترسی به جدیدترین مدل‌های دنیا</h3>
        <p>ChatGPT، Claude، Gemini، Grok، DeepSeek و مدل‌های دیگه — با پرداخت ریالی و به‌صرفه، بدون فیلترشکن و بدون کارت بانکی خارجی.</p>
        <a href="/login">شروع رایگان ←</a>
      </footer>
    </article>`;

  return renderLayout({
    title: `${article.title} | نیوو`,
    description,
    ogImage: article.coverImageUrl,
    canonicalPath: `/blog/${article.slug}`,
    bodyHtml,
  });
}
