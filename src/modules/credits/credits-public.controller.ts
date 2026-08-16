import { Controller, Get } from '@nestjs/common';
import { CreditsService } from './credits.service';

// مسیر عمومی (بدون JwtGuard) — دقیقاً هم‌الگوی discovery-public.controller.ts: لیست بسته‌های
// خرید اعتبار (نیوو) بدون هیچ داده‌ی شخصی‌سازی‌شده (موجودی/تخفیف مخصوص کاربر) است، فقط
// بسته‌های فعال + قیمت محاسبه‌شده — پس نمایشش روی لندینگ (قبل از ثبت‌نام) بی‌خطر است
@Controller('v2/credits')
export class CreditsPublicController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('packages')
  listPackages() {
    return this.creditsService.listPackages();
  }
}
