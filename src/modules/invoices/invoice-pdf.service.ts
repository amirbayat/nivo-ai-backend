import { Injectable } from '@nestjs/common'
import * as path from 'path'
import PDFDocument from 'pdfkit'
import * as reshaper from 'arabic-persian-reshaper'
import { Invoice } from '@prisma/client'

const FONT_REGULAR = path.join(process.cwd(), 'assets/fonts/Vazirmatn-Regular.ttf')
const FONT_BOLD = path.join(process.cwd(), 'assets/fonts/Vazirmatn-Bold.ttf')

const PAGE_WIDTH = 595.28 // A4 در پوینت
const MARGIN = 50
const RIGHT_X = PAGE_WIDTH - MARGIN

const PROVIDER_LABELS: Record<string, string> = {
  ZARINPAL: 'زرین‌پال',
  VANDAR: 'وندار',
  ZIBAL: 'زیبال',
}

/** متن فارسی را برای رندر درست RTL توی pdfkit آماده می‌کند (reshape + معکوس‌سازی بصری) */
function rtl(text: string): string {
  const reshaped = reshaper.PersianShaper.convertArabic(text)
  return Array.from(reshaped).reverse().join('')
}

function toman(rial: number): string {
  return Math.round(rial / 10).toLocaleString('en-US')
}

function invoiceNumber(inv: Invoice): string {
  const year = new Date(inv.issuedAt).getFullYear() - 621 // میلادی به شمسی، تقریبی — فقط برای شماره‌گذاری نمایشی
  return `INV-${year}-${String(inv.number).padStart(6, '0')}`
}

@Injectable()
export class InvoicePdfService {
  async generate(invoice: Invoice): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      doc.registerFont('vazir', FONT_REGULAR)
      doc.registerFont('vazir-bold', FONT_BOLD)

      // هدر
      doc.font('vazir-bold').fontSize(22).fillColor('#0f172a')
      doc.text(rtl('فاکتور خرید'), MARGIN, MARGIN, { width: RIGHT_X - MARGIN, align: 'right' })

      doc.font('vazir').fontSize(11).fillColor('#64748b')
      doc.text(invoiceNumber(invoice), MARGIN, MARGIN + 32, { width: RIGHT_X - MARGIN, align: 'left' })

      doc.moveDown(2)
      doc.moveTo(MARGIN, 100).lineTo(RIGHT_X, 100).strokeColor('#e2e8f0').stroke()

      // اطلاعات خریدار و فاکتور — دو ستونه
      let y = 120
      const row = (label: string, value: string) => {
        doc.font('vazir').fontSize(10).fillColor('#64748b')
        doc.text(rtl(label), MARGIN, y, { width: 200, align: 'left' })
        doc.font('vazir').fontSize(11).fillColor('#0f172a')
        doc.text(value, MARGIN, y, { width: RIGHT_X - MARGIN, align: 'right' })
        y += 24
      }

      row('تاریخ صدور', new Date(invoice.issuedAt).toLocaleDateString('fa-IR'))
      row('نام خریدار', invoice.buyerName ? rtl(invoice.buyerName) : '—')
      row('شماره موبایل', invoice.buyerPhone)
      row('درگاه پرداخت', rtl(PROVIDER_LABELS[invoice.provider] ?? invoice.provider))
      if (invoice.refId) row('کد پیگیری', invoice.refId)

      y += 10
      doc.moveTo(MARGIN, y).lineTo(RIGHT_X, y).strokeColor('#e2e8f0').stroke()
      y += 20

      // جدول یک‌ردیفه‌ی خرید
      doc.font('vazir-bold').fontSize(11).fillColor('#0f172a')
      doc.text(rtl('شرح'), MARGIN, y, { width: 150, align: 'right' })
      doc.text(rtl('مبلغ (تومان)'), MARGIN, y, { width: RIGHT_X - MARGIN - 150, align: 'left' })
      y += 20
      doc.moveTo(MARGIN, y).lineTo(RIGHT_X, y).strokeColor('#e2e8f0').stroke()
      y += 12

      doc.font('vazir').fontSize(11).fillColor('#334155')
      doc.text(rtl(`اشتراک ${invoice.planName}`), MARGIN, y, { width: 250, align: 'right' })
      doc.text(toman(invoice.amount), MARGIN, y, { width: RIGHT_X - MARGIN - 20, align: 'left' })
      y += 30

      doc.moveTo(MARGIN, y).lineTo(RIGHT_X, y).strokeColor('#e2e8f0').stroke()
      y += 16

      doc.font('vazir-bold').fontSize(13).fillColor('#0f172a')
      doc.text(rtl('مبلغ نهایی (تومان)'), MARGIN, y, { width: 250, align: 'right' })
      doc.text(toman(invoice.amount), MARGIN, y, { width: RIGHT_X - MARGIN - 20, align: 'left' })

      // فوتر
      doc.font('vazir').fontSize(8).fillColor('#94a3b8')
      doc.text(
        rtl('این یک رسید داخلی است، نه فاکتور رسمی سامانه‌ی مودیان.'),
        MARGIN,
        750,
        { width: RIGHT_X - MARGIN, align: 'center', lineBreak: false },
      )

      doc.end()
    })
  }
}
