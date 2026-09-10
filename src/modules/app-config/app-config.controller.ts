import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatConfigService } from '../chat-config/chat-config.service';

@Controller('config')
export class AppConfigController {
  constructor(
    private readonly config: ConfigService,
    private readonly chatConfig: ChatConfigService,
  ) {}

  @Get('features')
  async getFeatures() {
    // maxImagesPerMessage/maxImageSizeMb از ChatConfig (قابل‌تنظیم در ادمین) می‌آیند، نه env —
    // docs/PRD-chat-images.md بخش ۵.۶، تا فرانت و بک‌اند همیشه یک عدد واحد را رعایت کنند
    const chatConfig = await this.chatConfig.getConfig();
    return {
      showDailyBudget:
        this.config.get<string>('SHOW_DAILY_BUDGET', 'true') === 'true',
      showMonthlyTokenUsage:
        this.config.get<string>('SHOW_MONTHLY_TOKEN_USAGE', 'true') === 'true',
      maxImagesPerMessage: chatConfig.maxImagesPerMessage,
      maxImageSizeMb: chatConfig.maxImageSizeMb,
      // docs/PRD-chat-files-and-pdf.md بخش ۳ — تعداد فایل هر پیام همان سقف @ArrayMaxSize روی
      // StreamMessageDto.files است (۳)، عمداً ثابت در کد نه ChatConfig (بحث جدایی نگرانی‌ها:
      // maxFileSizeMb سیاست هزینه/امنیت است، تعداد آرایه یک محدودیت ورودی ساده)
      maxFilesPerMessage: 3,
      maxFileSizeMb: chatConfig.maxFileSizeMb,
    };
  }
}
