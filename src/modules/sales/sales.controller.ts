import { Body, Controller, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SalesService } from './sales.service'
import { SalesChatDto, SaveLeadDto, TrackCtaClickDto } from './dto/sales-chat.dto'

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('chat')
  chat(@Body() dto: SalesChatDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress
      ?? 'unknown'
    return this.salesService.chat(dto, ip)
  }

  @Post('lead')
  saveLead(@Body() dto: SaveLeadDto) {
    return this.salesService.saveLead(dto)
  }

  @Post('cta-click')
  trackCtaClick(@Body() dto: TrackCtaClickDto) {
    return this.salesService.trackCtaClick(dto)
  }
}
