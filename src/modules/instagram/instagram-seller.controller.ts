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
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { StoreService } from '../store/store.service';
import { InstagramService } from './instagram.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { ConnectInstagramDto } from './dto/connect-instagram.dto';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳.۱/۴.۴ — فروشنده‌ی ایرانی، همان
// JwtGuard فعلی (شماره+OTP)؛ چون این فروشنده می‌تواند چند فروشگاه داشته باشد، storeId از
// مسیر می‌آید و مالکیت با StoreService.getOwned (الگوی موجود store.controller.ts) چک می‌شود
@Controller('v2/stores/:storeId/instagram')
@UseGuards(JwtGuard)
export class InstagramSellerController {
  constructor(
    private readonly storeService: StoreService,
    private readonly instagram: InstagramService,
  ) {}

  @Get('connect-url')
  async connectUrl(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    return { url: this.instagram.getConnectUrl() };
  }

  @Post('connect')
  async connect(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectInstagramDto,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    const ok = await this.instagram.handleOAuthCallback(storeId, dto.code);
    return { connected: ok };
  }

  @Get('rules')
  async listRules(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    return this.instagram.listRules(storeId);
  }

  @Post('rules')
  async createRule(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    return this.instagram.createRule(storeId, dto);
  }

  @Patch('rules/:ruleId')
  async updateRule(
    @Param('storeId') storeId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    const updated = await this.instagram.updateRule(storeId, ruleId, dto);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Delete('rules/:ruleId')
  async deleteRule(
    @Param('storeId') storeId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.storeService.getOwned(user.sub, storeId);
    const deleted = await this.instagram.deleteRule(storeId, ruleId);
    if (!deleted) throw new NotFoundException();
    return { deleted: true };
  }
}
