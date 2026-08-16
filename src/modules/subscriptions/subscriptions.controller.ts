import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UseGuards(JwtGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  getMySubscription(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.getMySubscription(user.sub);
  }

  @Delete('me')
  cancel(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.cancel(user.sub);
  }
}
