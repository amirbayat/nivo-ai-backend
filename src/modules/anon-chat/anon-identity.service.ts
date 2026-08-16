import { BadRequestException, Injectable } from '@nestjs/common';
import type { AnonymousIdentity, AnonymousSession } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnonFunnelEventService } from './anon-funnel-event.service';
import type { InitAnonSessionDto } from './dto/init-anon-session.dto';

export interface AnonContext {
  identity: AnonymousIdentity;
  session: AnonymousSession;
}

// نگاشت (ip, clientToken) -> (AnonymousIdentity, AnonymousSession). شمارش/محدودیت روی
// identity (IP، durable — پاک کردن localStorage آن را دور نمی‌زند) است؛ مالکیت مکالمه و
// migration-on-login روی همان session خاص مرورگر (clientToken) است — نه کل IP، وگرنه لاگین
// از یک IP مشترک (دفتر/کافه) چت anonymous یک غریبه را هم می‌قاپد.
@Injectable()
export class AnonIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funnelEvents: AnonFunnelEventService,
  ) {}

  async resolveContext(
    ip: string,
    clientToken: string | undefined,
  ): Promise<AnonContext> {
    if (!clientToken)
      throw new BadRequestException('X-Anon-Session-Id header is required');

    const identity = await this.prisma.anonymousIdentity.upsert({
      where: { ip },
      create: { ip },
      update: { lastSeenAt: new Date() },
    });

    const session = await this.prisma.anonymousSession.upsert({
      where: { clientToken },
      create: { clientToken, identityId: identity.id },
      update: { lastSeenAt: new Date() },
    });

    return { identity, session };
  }

  // فراخوانی جدا از resolveContext معمولی — فقط یک‌بار در اولین بازدید (POST /anon-chat/session)
  // چون UTM/referrer فقط باید همان اولین‌بار ثبت شود، و بازدیدکننده‌هایی که هیچ پیامی نمی‌فرستند
  // («bounce») هم باید در فانل مرحله‌ی اول شمرده شوند.
  async initSession(
    ip: string,
    clientToken: string,
    dto: InitAnonSessionDto,
  ): Promise<AnonContext> {
    const context = await this.resolveContext(ip, clientToken);
    const isFirstInit =
      context.session.utmSource === null &&
      context.session.referrer === null &&
      context.session.landingPath === null;

    if (
      isFirstInit &&
      (dto.utmSource ||
        dto.utmMedium ||
        dto.utmCampaign ||
        dto.utmContent ||
        dto.utmTerm ||
        dto.referrer ||
        dto.landingPath)
    ) {
      context.session = await this.prisma.anonymousSession.update({
        where: { id: context.session.id },
        data: {
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmContent: dto.utmContent,
          utmTerm: dto.utmTerm,
          referrer: dto.referrer,
          landingPath: dto.landingPath,
        },
      });
    }

    await this.funnelEvents.emit(context.session.id, 'SESSION_CREATED');
    return context;
  }
}
