import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';

// docs/PRD-daily-content-prompt-agent.md بخش ۴ — هدر X-Api-Key را با ContentAgentApiKey فعال
// مطابقت می‌دهد؛ برای اسکریپت/CLI روی سیستم کاربر است، نه مرورگر — پس پشت JwtGuard نیست.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const rawKey = req.headers['x-api-key'];
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException(fa.auth.unauthorized);
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.prisma.contentAgentApiKey.findUnique({
      where: { keyHash },
    });
    if (!apiKey || !apiKey.isActive) {
      throw new UnauthorizedException(fa.auth.unauthorized);
    }

    await this.prisma.contentAgentApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });
    return true;
  }
}
