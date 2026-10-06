import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IntlJwtGuard } from '../../common/guards/intl-jwt.guard';
import {
  CurrentIntlUser,
  IntlJwtPayload,
} from '../../common/decorators/current-intl-user.decorator';
import { InstagramService } from './instagram.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { ConnectInstagramDto } from './dto/connect-instagram.dto';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳.۱/۴.۴ — فروشنده‌ی خارجی: دقیقاً
// همین دو صفحه کل چیزی است که می‌بیند. storeId از توکن می‌آید (هر کاربر دقیقاً یک فروشگاه
// دارد — IntlAuthService.verifyCode)، پس نیازی به چک مالکیت جدا نیست
@Controller('intl/instagram')
@UseGuards(IntlJwtGuard)
export class InstagramIntlSellerController {
  constructor(private readonly instagram: InstagramService) {}

  @Get('status')
  status(@CurrentIntlUser() user: IntlJwtPayload) {
    return this.instagram.getStoreInstagramStatus(user.storeId);
  }

  @Get('connect-url')
  connectUrl() {
    return { url: this.instagram.getConnectUrl() };
  }

  @Post('connect')
  async connect(
    @CurrentIntlUser() user: IntlJwtPayload,
    @Body() dto: ConnectInstagramDto,
  ) {
    const ok = await this.instagram.handleOAuthCallback(user.storeId, dto.code);
    return { connected: ok };
  }

  @Get('rules')
  listRules(@CurrentIntlUser() user: IntlJwtPayload) {
    return this.instagram.listRules(user.storeId);
  }

  @Post('rules')
  createRule(
    @CurrentIntlUser() user: IntlJwtPayload,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.instagram.createRule(user.storeId, dto);
  }

  @Patch('rules/:ruleId')
  async updateRule(
    @CurrentIntlUser() user: IntlJwtPayload,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    const updated = await this.instagram.updateRule(user.storeId, ruleId, dto);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Delete('rules/:ruleId')
  async deleteRule(
    @CurrentIntlUser() user: IntlJwtPayload,
    @Param('ruleId') ruleId: string,
  ) {
    const deleted = await this.instagram.deleteRule(user.storeId, ruleId);
    if (!deleted) throw new NotFoundException();
    return { deleted: true };
  }
}
