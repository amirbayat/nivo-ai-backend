import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { DemoService } from './demo.service';
import { EnsureDemoStoreDto } from './dto/ensure-demo-store.dto';

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۲، ۵.۳
@Controller('v2/demo/stores')
@UseGuards(JwtGuard)
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post('ensure')
  ensure(@CurrentUser() user: JwtPayload, @Body() dto: EnsureDemoStoreDto) {
    return this.demoService.ensureDemoStore(user.sub, dto.category);
  }

  @Post(':storeId/convert-to-real')
  convertToReal(
    @CurrentUser() user: JwtPayload,
    @Param('storeId') storeId: string,
  ) {
    return this.demoService.convertToReal(user.sub, storeId);
  }
}
