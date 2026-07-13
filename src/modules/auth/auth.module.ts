import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AdminOtpController } from './admin-otp.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { SmsModule } from '../../sms/sms.module'
import { CampaignModule } from '../campaign/campaign.module'

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    SmsModule,
    CampaignModule,
  ],
  controllers: [AuthController, AdminOtpController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
