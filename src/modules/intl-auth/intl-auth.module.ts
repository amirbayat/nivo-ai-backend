import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { IntlAuthController } from './intl-auth.controller';
import { IntlAuthService } from './intl-auth.service';
import { IntlJwtStrategy } from './intl-jwt.strategy';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), EmailModule],
  controllers: [IntlAuthController],
  providers: [IntlAuthService, IntlJwtStrategy],
  exports: [IntlAuthService],
})
export class IntlAuthModule {}
