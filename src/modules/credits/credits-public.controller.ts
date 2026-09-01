import { Controller, Get, Query } from '@nestjs/common';
import { CreditPackageScope } from '@prisma/client';
import { CreditsService } from './credits.service';

// مسیر عمومی (بدون JwtGuard) — دقیقاً هم‌الگوی discovery-public.controller.ts: لیست بسته‌های
// خرید اعتبار (نیوو) بدون هیچ داده‌ی شخصی‌سازی‌شده (موجودی/تخفیف مخصوص کاربر) است، فقط
// بسته‌های فعال + قیمت محاسبه‌شده — پس نمایشش روی لندینگ (قبل از ثبت‌نام) بی‌خطر است
@Controller('v2/credits')
export class CreditsPublicController {
  constructor(private readonly creditsService: CreditsService) {}

  // بدون ?scope رفتار فعلی (بسته‌های GENERAL) دقیقاً حفظ می‌شود — صفر تغییر رفتار برای
  // فرانت اصلی (nivo-ai-frontend). فقط نیوو کال (وب/اپ) با scope=NIVO_CAL این پارامتر رو می‌فرسته.
  @Get('packages')
  listPackages(@Query('scope') scope?: CreditPackageScope) {
    return this.creditsService.listPackages(scope);
  }
}
