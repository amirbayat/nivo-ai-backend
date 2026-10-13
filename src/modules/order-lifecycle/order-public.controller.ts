import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrderPublicService } from './order-public.service';
import { OrderIssueDto, RefundDestinationDto } from './dto/order-public.dto';

@Controller('v2/o')
export class OrderPublicController {
  constructor(private readonly orders: OrderPublicService) {}

  @Get(':code')
  view(@Param('code') code: string, @Query('t') token: string | undefined, @Req() req: Request) {
    return this.orders.resolve(code, token, req.ip ?? '0');
  }

  @Post(':code/refunds/:refundId/destination')
  destinationById(
    @Param('code') code: string,
    @Param('refundId') refundId: string,
    @Query('t') token: string | undefined,
    @Body() dto: RefundDestinationDto,
    @Req() req: Request,
  ) {
    return this.orders.setDestination(code, token, req.ip ?? '0', refundId, dto.destination, dto.holderName);
  }

  @Post(':code/cancel')
  cancel(@Param('code') code: string, @Query('t') token: string | undefined, @Req() req: Request) {
    return this.orders.cancel(code, token, req.ip ?? '0');
  }

  @Post(':code/delivered')
  delivered(@Param('code') code: string, @Query('t') token: string | undefined, @Req() req: Request) {
    return this.orders.confirmDelivery(code, token, req.ip ?? '0');
  }

  @Post(':code/issue')
  issue(
    @Param('code') code: string,
    @Query('t') token: string | undefined,
    @Body() dto: OrderIssueDto,
    @Req() req: Request,
  ) {
    return this.orders.reportIssue(code, token, req.ip ?? '0', dto.reason, dto.text);
  }

  @Post(':code/refunds/:refundId/nudge')
  nudge(
    @Param('code') code: string,
    @Param('refundId') refundId: string,
    @Query('t') token: string | undefined,
    @Req() req: Request,
  ) {
    return this.orders.nudge(code, token, req.ip ?? '0', refundId);
  }
}
