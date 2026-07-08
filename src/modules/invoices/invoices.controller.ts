import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { InvoicesService } from './invoices.service'

function invoiceFileName(number: number): string {
  return `invoice-${String(number).padStart(6, '0')}.pdf`
}

@Controller('invoices')
@UseGuards(JwtGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.invoicesService.findAll(user.sub)
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.invoicesService.findOne(user.sub, id)
  }

  @Get(':id/pdf')
  async downloadPdf(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Res() res: Response) {
    const { buffer, invoice } = await this.invoicesService.generatePdf(user.sub, id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceFileName(invoice.number)}"`)
    res.send(buffer)
  }
}
