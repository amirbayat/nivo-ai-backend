import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IntlAuthService } from './intl-auth.service';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';
import { IntlRefreshTokenDto } from './dto/intl-refresh-token.dto';
import { IntlJwtGuard } from '../../common/guards/intl-jwt.guard';
import {
  CurrentIntlUser,
  IntlJwtPayload,
} from '../../common/decorators/current-intl-user.decorator';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳/۷.۱ — فقط برای REGION=INTL؛
// معادل AuthController ایرانی ولی ایمیل+کد به‌جای شماره+OTP
@Controller('intl-auth')
export class IntlAuthController {
  constructor(private readonly intlAuth: IntlAuthService) {}

  @Post('send-code')
  @HttpCode(200)
  sendCode(@Body() dto: SendEmailCodeDto) {
    return this.intlAuth.sendCode(dto.email);
  }

  @Post('verify-code')
  @HttpCode(200)
  verifyCode(@Body() dto: VerifyEmailCodeDto) {
    return this.intlAuth.verifyCode(dto.email, dto.code);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: IntlRefreshTokenDto) {
    return this.intlAuth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(IntlJwtGuard)
  logout(@Body() dto: IntlRefreshTokenDto) {
    return this.intlAuth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(IntlJwtGuard)
  getMe(@CurrentIntlUser() user: IntlJwtPayload) {
    return user;
  }
}
