import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { EmailService } from '../../email/email.service';
import { generateShortCode } from '../../common/utils/generate-code';
import { en } from '../../i18n/en';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳/۷.۱ — آینه‌ی ساده‌شده‌ی auth.service.ts
// برای REGION=INTL: بدون کمپین/پاداش معرف/اعتبار رایگان/PAYG (هیچ‌کدام برای مینی‌پنل رایگان
// فاز ۱ موضوعیت ندارد)؛ عمداً سرویس جدا، نه افزودن شاخه‌ی if به AuthService موجود — آن سرویس
// عمیقاً phone-محور است (۱۹۰+ جای استفاده‌ی JwtPayload.phone در کل پروژه)
const CODE_TTL_SECONDS = 120;
const RATE_LIMIT = 3;
const RATE_WINDOW_SECONDS = 600;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_SECONDS = 1800;

function codeKey(email: string) {
  return `intl-email-otp:${email}`;
}
function rateKey(email: string) {
  return `intl-email-otp:rate:${email}`;
}
function attemptKey(email: string) {
  return `intl-email-otp:attempt:${email}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class IntlAuthService {
  private readonly logger = new Logger(IntlAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async sendCode(rawEmail: string): Promise<{ message: string }> {
    const email = normalizeEmail(rawEmail);

    const key = rateKey(email);
    const sends = await this.redis.incr(key);
    if (sends === 1) await this.redis.expire(key, RATE_WINDOW_SECONDS);
    if (sends > RATE_LIMIT) {
      throw new HttpException(
        en.auth.codeTooManyRequests(Math.ceil(RATE_WINDOW_SECONDS / 60)),
        429,
      );
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(codeKey(email), code, 'EX', CODE_TTL_SECONDS);

    await this.email.sendVerificationCode(email, code);

    return { message: en.auth.codeSent };
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const code = generateShortCode();
      const clash = await this.prisma.user.findUnique({
        where: { referralCode: code },
      });
      if (!clash) return code;
      if (attempt > 5)
        throw new Error('failed to generate unique referral code');
    }
  }

  private async generateUniqueSlug(): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const slug = `seller-${generateShortCode(8).toLowerCase()}`;
      const clash = await this.prisma.store.findUnique({ where: { slug } });
      if (!clash) return slug;
      if (attempt > 5) throw new Error('failed to generate unique slug');
    }
  }

  async verifyCode(
    rawEmail: string,
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const email = normalizeEmail(rawEmail);

    const attempts = await this.redis.incr(attemptKey(email));
    if (attempts === 1)
      await this.redis.expire(attemptKey(email), ATTEMPT_WINDOW_SECONDS);
    if (attempts > ATTEMPT_LIMIT) {
      throw new HttpException(
        en.auth.codeTooManyAttempts(Math.ceil(ATTEMPT_WINDOW_SECONDS / 60)),
        429,
      );
    }

    const stored = await this.redis.get(codeKey(email));
    if (!stored) throw new HttpException(en.auth.codeExpired, 401);
    if (stored !== code) throw new HttpException(en.auth.codeInvalid, 401);

    await this.redis.del(codeKey(email), rateKey(email), attemptKey(email));

    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { stores: { select: { id: true }, take: 1 } },
    });

    if (!user) {
      const created = await this.prisma.user.create({
        data: {
          email,
          referralCode: await this.generateUniqueReferralCode(),
        },
      });
      user = { ...created, stores: [] };
    }

    if (!user.isActive) throw new HttpException(en.auth.userDisabled, 401);

    let storeId = user.stores[0]?.id;
    if (!storeId) {
      // docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳.۱ — فروشنده‌ی INTL هیچ ویزارد
      // ثبت‌نامی نمی‌بیند (نه slug نه bankCard)؛ فروشگاهش همین‌جا خودکار ساخته می‌شود
      const store = await this.prisma.store.create({
        data: {
          sellerId: user.id,
          slug: await this.generateUniqueSlug(),
          name: email,
        },
        select: { id: true },
      });
      storeId = store.id;
    }

    return this.issueTokens(user.id, email, storeId);
  }

  private async issueTokens(
    userId: string,
    email: string,
    storeId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: userId, email, storeId };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN'),
    });

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  async refresh(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: {
        user: { include: { stores: { select: { id: true }, take: 1 } } },
      },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      !stored.user.email
    ) {
      throw new HttpException(en.auth.refreshTokenInvalid, 401);
    }
    if (!stored.user.isActive)
      throw new HttpException(en.auth.userDisabled, 401);

    const storeId = stored.user.stores[0]?.id;
    if (!storeId) throw new HttpException(en.auth.unauthorized, 401);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user.id, stored.user.email, storeId);
  }

  async logout(rawToken: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    });
  }
}
