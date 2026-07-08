import { Injectable, OnModuleDestroy } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import puppeteer, { Browser } from 'puppeteer'
import { Invoice } from '@prisma/client'

const FONT_DIR = path.join(process.cwd(), 'assets/fonts')

const PROVIDER_LABELS: Record<string, string> = {
  ZARINPAL: 'زرین‌پال',
  VANDAR: 'وندار',
  ZIBAL: 'زیبال',
}

function toman(rial: number): string {
  return Math.round(rial / 10).toLocaleString('en-US')
}

function invoiceNumber(inv: Invoice): string {
  const year = new Date(inv.issuedAt).getFullYear() - 621 // میلادی به شمسی، تقریبی — فقط برای شماره‌گذاری نمایشی
  return `INV-${year}-${String(inv.number).padStart(6, '0')}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * تولید PDF فاکتور با رندر HTML توسط Chromium (نه ترسیم دستی گلیف).
 * چون بدون شکل‌دهی/معکوس‌سازی دستی حروف فارسی (که در ویوئرهای PDF مختلف رفتار
 * ناسازگار داشت)، مرورگر خودش bidi و شکل‌دهی حروف عربی/فارسی را درست انجام می‌دهد.
 */
@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null
  private readonly fontRegularBase64 = fs.readFileSync(path.join(FONT_DIR, 'Vazirmatn-Regular.ttf')).toString('base64')
  private readonly fontBoldBase64 = fs.readFileSync(path.join(FONT_DIR, 'Vazirmatn-Bold.ttf')).toString('base64')

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    }
    return this.browserPromise
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      const browser = await this.browserPromise
      await browser.close()
    }
  }

  private buildHtml(invoice: Invoice): string {
    const rows: Array<[string, string]> = [
      ['تاریخ صدور', new Date(invoice.issuedAt).toLocaleDateString('fa-IR')],
      ['نام خریدار', invoice.buyerName ? escapeHtml(invoice.buyerName) : '—'],
      ['شماره موبایل', invoice.buyerPhone],
      ['درگاه پرداخت', PROVIDER_LABELS[invoice.provider] ?? invoice.provider],
    ]
    if (invoice.refId) rows.push(['کد پیگیری', invoice.refId])

    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Vazirmatn';
    src: url(data:font/ttf;base64,${this.fontRegularBase64}) format('truetype');
    font-weight: 400;
  }
  @font-face {
    font-family: 'Vazirmatn';
    src: url(data:font/ttf;base64,${this.fontBoldBase64}) format('truetype');
    font-weight: 700;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    margin: 0;
    padding: 40px 50px;
    color: #0f172a;
    font-size: 14px;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
  .title { font-size: 24px; font-weight: 700; }
  .invoice-no { font-size: 13px; color: #64748b; direction: ltr; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .row .label { color: #64748b; font-size: 13px; }
  .row .value { font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th { text-align: right; font-size: 13px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
  th.amount, td.amount { text-align: left; direction: ltr; }
  td { padding: 14px 0; border-bottom: 1px solid #f1f5f9; }
  .total-row { display: flex; justify-content: space-between; margin-top: 16px; font-weight: 700; font-size: 16px; }
  .total-row .amount { direction: ltr; }
  .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">فاکتور خرید</div>
    <div class="invoice-no">${invoiceNumber(invoice)}</div>
  </div>

  ${rows.map(([label, value]) => `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`).join('\n')}

  <table>
    <thead>
      <tr><th>شرح</th><th class="amount">مبلغ (تومان)</th></tr>
    </thead>
    <tbody>
      <tr><td>اشتراک ${escapeHtml(invoice.planName)}</td><td class="amount">${toman(invoice.amount)}</td></tr>
    </tbody>
  </table>

  <div class="total-row">
    <span>مبلغ نهایی (تومان)</span>
    <span class="amount">${toman(invoice.amount)}</span>
  </div>

  <div class="footer">این یک رسید داخلی است، نه فاکتور رسمی سامانه‌ی مودیان.</div>
</body>
</html>`
  }

  async generate(invoice: Invoice): Promise<Buffer> {
    const browser = await this.getBrowser()
    const page = await browser.newPage()
    try {
      await page.setContent(this.buildHtml(invoice), { waitUntil: 'load' })
      const pdf = await page.pdf({
        format: 'a4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      })
      return Buffer.from(pdf)
    } finally {
      await page.close()
    }
  }
}
