import { Body, Controller, Get, Param, Post, Query, Redirect, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { PaymentsService } from './payments.service'
import { InitiatePaymentDto } from './dto/initiate-payment.dto'

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initiate')
  @UseGuards(JwtGuard)
  initiate(@CurrentUser() user: JwtPayload, @Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiate(user.sub, dto)
  }

  @Get('gateways')
  getEnabledGateways() {
    return { gateways: this.paymentsService.getEnabledGateways() }
  }

  @Get('validate-discount')
  @UseGuards(JwtGuard)
  validateDiscount(@CurrentUser() user: JwtPayload, @Query('code') code: string) {
    return this.paymentsService.validateDiscountCode(user.sub, code)
  }

  @Get('callback/:provider')
  @Redirect()
  async callback(@Param('provider') provider: string, @Query() query: Record<string, string>) {
    const result = await this.paymentsService.verifyCallback(provider, query)
    return { url: result.redirect }
  }

  @Get()
  @UseGuards(JwtGuard)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.findAll(user.sub)
  }

  @Get('history')
  @UseGuards(JwtGuard)
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.getHistory(user.sub)
  }
}
