import {
  Body,
  Controller,
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
}
