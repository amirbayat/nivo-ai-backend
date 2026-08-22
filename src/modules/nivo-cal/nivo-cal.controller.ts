import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { NivoCalService } from './nivo-cal.service';
import { ScanFoodDto } from './dto/scan-food.dto';
import { CreateNutritionProfileDto } from './dto/create-nutrition-profile.dto';
import { LogWeightDto } from './dto/log-weight.dto';

@Controller('nivo-cal')
@UseGuards(JwtGuard)
export class NivoCalController {
  constructor(private readonly nivoCalService: NivoCalService) {}

  @Post('scan')
  scan(@Body() dto: ScanFoodDto, @CurrentUser() user: JwtPayload) {
    return this.nivoCalService.scan(user.sub, dto.image, dto.note);
  }

  @Get('logs')
  listLogs(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.nivoCalService.listLogs(
      user.sub,
      limit ? Number(limit) : undefined,
    );
  }

  // برای حذف اسکن‌های اشتباهی/تستی (مثلاً کاربر فقط برای امتحان یک غذا اسکن کرده) — چک مالکیت
  // داخل service انجام می‌شود، دقیقاً همون الگوی امنیتی getImage زیر
  @Delete('logs/:id')
  deleteLog(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.nivoCalService.deleteLog(user.sub, id);
  }

  // پشت JwtGuard + چک مالکیت (nivoCalService.getImage) — دقیقاً همون الگوی امنیتی چت‌ایمیج/
  // دیسکاوری: کلید MinIO هیچ‌وقت مستقیم/presigned به فرانت داده نمی‌شود
  @Get('images/:key')
  async getImage(
    @Param('key') key: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.nivoCalService.getImage(
      user.sub,
      key,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  }

  // یک شیء برمی‌گرداند نه مستقیم null — NestJS (ExpressAdapter.reply) وقتی بدنه‌ی پاسخ کنترلر
  // دقیقاً null/undefined باشد، بدنه‌ی پاسخ را کاملاً خالی می‌فرستد (نه JSON literal «null»)،
  // که axios آن را به رشته‌ی خالی تبدیل می‌کند نه null — چک‌های «profile === null» فرانت را می‌شکند
  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    const profile = await this.nivoCalService.getProfile(user.sub);
    return { profile };
  }

  @Post('profile')
  createProfile(
    @Body() dto: CreateNutritionProfileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.nivoCalService.createOrUpdateProfile(user.sub, dto);
  }

  @Post('weight')
  logWeight(@Body() dto: LogWeightDto, @CurrentUser() user: JwtPayload) {
    return this.nivoCalService.logWeight(user.sub, dto.weightKg);
  }

  @Get('daily-summary')
  getDailySummary(@CurrentUser() user: JwtPayload) {
    return this.nivoCalService.getDailySummary(user.sub);
  }
}
