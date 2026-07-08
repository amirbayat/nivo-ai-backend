import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { InvoicePdfService } from './invoice-pdf.service'
import { fa } from '../../i18n/fa'

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InvoicePdfService,
  ) {}

  findAll(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    })
  }

  async findOne(userId: string, id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } })
    if (!invoice || invoice.userId !== userId) throw new NotFoundException(fa.invoice.notFound)
    return invoice
  }

  async generatePdf(userId: string, id: string) {
    const invoice = await this.findOne(userId, id)
    const buffer = await this.pdf.generate(invoice)
    return { buffer, invoice }
  }
}
