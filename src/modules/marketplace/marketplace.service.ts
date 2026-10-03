import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { fa } from '../../i18n/fa';
import type { CartItem } from '../sales-agent/sales-agent.types';

// docs/PRD-marketplace-explore-cross-store.md بخش ۷ (فاز ۵ MVP) — «سفارش‌های من، همه‌ی
// فروشگاه‌ها». عمداً از auth.service.ts's sendOtp/verifyOtp استفاده نشد: آن متد همیشه یک
// User می‌سازد و JWT فروشنده/کاربر صادر می‌کند — خریدار اینجا نباید هیچ‌وقت حساب User بشود.
// همون الگوی rate-limit/TTL روی کلیدهای Redis جدا (پیشوند marketplaceOtp) تکرار شده.
const OTP_TTL_SECONDS = 120;
const OTP_RATE_LIMIT = 3;
const OTP_RATE_WINDOW_SECONDS = 600;
const OTP_ATTEMPT_LIMIT = 5;
const OTP_ATTEMPT_WINDOW_SECONDS = 1800;
const BUYER_TOKEN_SCOPE = 'buyer_orders';
const BUYER_TOKEN_TTL = '30m';

function otpKey(phone: string) {
  return `marketplaceOtp:${phone}`;
}
function otpRateKey(phone: string) {
  return `marketplaceOtp:rate:${phone}`;
}
function otpAttemptKey(phone: string) {
  return `marketplaceOtp:attempt:${phone}`;
}

// فیلد Order.recipientPhone آزاد تایپ شده (conversation-engine.service.ts's doCollectAddress)
// و normalizePhone صدا زده نمی‌شود — یعنی داده‌ی موجود می‌تواند «09xxxxxxxxx»، «+989xxxxxxxxx»
// یا حتی بدون پیشوند «9xxxxxxxxx» ذخیره شده باشد. برای درست پیداکردن سفارش‌ها باید هر سه حالت
// را جست‌وجو کرد، نه فقط یک فرمت کانونیک.
function phoneVariants(rawPhone: string): string[] {
  const bare = normalizePhone(rawPhone).replace(/^0/, '');
  return [`0${bare}`, `+98${bare}`, bare];
}

interface BuyerTokenPayload {
  phone: string;
  scope: typeof BUYER_TOKEN_SCOPE;
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  async listActiveStores() {
    const stores = await this.prisma.store.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        logoImageKey: true,
      },
      orderBy: { name: 'asc' },
    });
    return { stores };
  }

  async sendOtp(rawPhone: string): Promise<{ message: string }> {
    const phone = normalizePhone(rawPhone);

    const rateKey = otpRateKey(phone);
    const sends = await this.redis.incr(rateKey);
    if (sends === 1) await this.redis.expire(rateKey, OTP_RATE_WINDOW_SECONDS);
    if (sends > OTP_RATE_LIMIT) {
      throw new HttpException(
        fa.auth.otpTooManyRequests(Math.ceil(OTP_RATE_WINDOW_SECONDS / 60)),
        429,
      );
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(otpKey(phone), code, 'EX', OTP_TTL_SECONDS);
    await this.sms.sendOtp(phone, code);

    return { message: fa.auth.otpSent };
  }

  async verifyOtp(rawPhone: string, code: string): Promise<{ token: string }> {
    const phone = normalizePhone(rawPhone);

    const attemptKey = otpAttemptKey(phone);
    const attempts = await this.redis.incr(attemptKey);
    if (attempts === 1)
      await this.redis.expire(attemptKey, OTP_ATTEMPT_WINDOW_SECONDS);
    if (attempts > OTP_ATTEMPT_LIMIT) {
      throw new HttpException(
        fa.auth.otpTooManyAttempts(Math.ceil(OTP_ATTEMPT_WINDOW_SECONDS / 60)),
        429,
      );
    }

    const stored = await this.redis.get(otpKey(phone));
    if (!stored) throw new UnauthorizedException(fa.auth.otpExpired);
    if (stored !== code) throw new UnauthorizedException(fa.auth.otpInvalid);

    await this.redis.del(otpKey(phone), otpRateKey(phone), attemptKey);

    const payload: BuyerTokenPayload = { phone, scope: BUYER_TOKEN_SCOPE };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: BUYER_TOKEN_TTL,
    });
    return { token };
  }

  private async resolvePhoneFromToken(bearerToken: string): Promise<string> {
    const token = bearerToken.replace(/^Bearer\s+/i, '');
    let payload: BuyerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<BuyerTokenPayload>(token, {
        secret: this.config.get('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(fa.marketplace.invalidSession);
    }
    if (payload.scope !== BUYER_TOKEN_SCOPE) {
      throw new UnauthorizedException(fa.marketplace.invalidSession);
    }
    return payload.phone;
  }

  async getOrdersForToken(bearerToken: string) {
    const phone = await this.resolvePhoneFromToken(bearerToken);
    const variants = phoneVariants(phone);

    const orders = await this.prisma.order.findMany({
      where: { recipientPhone: { in: variants } },
      include: { store: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const byStore = new Map<
      string,
      {
        storeId: string;
        storeName: string;
        storeSlug: string;
        orders: {
          id: string;
          createdAt: Date;
          items: CartItem[];
          totalAmount: number;
          status: string;
        }[];
      }
    >();
    for (const order of orders) {
      const group = byStore.get(order.storeId) ?? {
        storeId: order.store.id,
        storeName: order.store.name,
        storeSlug: order.store.slug,
        orders: [],
      };
      group.orders.push({
        id: order.id,
        createdAt: order.createdAt,
        items: order.items as unknown as CartItem[],
        totalAmount: order.totalAmount,
        status: order.status,
      });
      byStore.set(order.storeId, group);
    }

    return { stores: Array.from(byStore.values()) };
  }
}
