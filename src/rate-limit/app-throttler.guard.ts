import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  // مسیرها با JwtGuard خودشان req.user را پر می‌کنند، اما این guard سراسری
  // است و قبل از guard های سطح route اجرا می‌شود — پس req.user هنوز خالی است
  // و باید توکن را مستقل بررسی کنیم (فقط برای شناسایی، نه احراز هویت).
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const authHeader = req.headers?.authorization as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwtService.verifyAsync(authHeader.slice(7), {
          secret: this.configService.get<string>('JWT_SECRET'),
        });
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        // توکن نامعتبر/منقضی — به ردیابی بر اساس IP سقوط می‌کنیم
      }
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      'unknown';
    return `ip:${ip}`;
  }
}
