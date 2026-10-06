import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { IntlJwtPayload } from '../../common/decorators/current-intl-user.decorator';
import { en } from '../../i18n/en';

// نام استراتژی 'intl-jwt' عمداً متفاوت از 'jwt' پیش‌فرض (jwt.strategy.ts) است — دو گارد کاملاً
// مجزا، بدون تداخل با مسیر ایرانی
@Injectable()
export class IntlJwtStrategy extends PassportStrategy(Strategy, 'intl-jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: IntlJwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { stores: { select: { id: true }, take: 1 } },
    });
    if (!user || !user.isActive || !user.email) {
      throw new UnauthorizedException(en.auth.unauthorized);
    }
    const storeId = user.stores[0]?.id;
    if (!storeId) {
      throw new UnauthorizedException(en.auth.unauthorized);
    }
    return { sub: user.id, email: user.email, storeId };
  }
}
