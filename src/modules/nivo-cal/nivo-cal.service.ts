import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import type { UserModelMessage } from 'ai';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { ChatConfigService } from '../chat-config/chat-config.service';
import { CreditsService } from '../credits/credits.service';
import { LiaraKeyProvisioningService } from '../liara/liara-key-provisioning.service';
import { StorageService } from '../../storage/storage.service';
import { fa } from '../../i18n/fa';
import {
  mimeTypeForExt,
  normalizeHeicDataUrl,
  parseChatImageDataUrl,
  validateChatImages,
} from '../../common/validators/chat-image.validator';

// تصمیم محصول (docs/PRD-nivo-cal.md بخش ۲.۲) — فاز ۱ عمداً یک مدل ثابت دارد، نه انتخاب
// دستی/خودکار بین چند تایر مثل «تبدیل عکس به پرامپت» — سادگی تجربه‌ی کاربر روی این فیچر
// بر انعطاف مدل ارجحیت دارد. این مدل هم‌اکنون هم extractionEconomicalModel پیش‌فرض
// (vision-capable) کاتالوگ است، پس نیازی به migration جدید روی AiModel نیست.
const NIVO_CAL_MODEL = 'openai/gpt-5.4-mini';

const EXTRACTION_TIMEOUT_MS = 15_000;

// اعداد به نزدیک‌ترین ۵ واحد گرد می‌شوند تا دقت کاذب نشان داده نشود (docs/PRD-nivo-cal.md
// بخش ۱ — «عدد بزرگ، اما صادقانه»)؛ گرد کردن همیشه سمت بک‌اند انجام می‌شود، نه فرانت
function roundToNearest5(n: number): number {
  return Math.max(0, Math.round(n / 5) * 5);
}

// fiberG/sugarG فقط .nullable() (نه .optional()) — با supportsStructuredOutputs=true، OpenAI
// روی این JSON schema حالت strict را اجرا می‌کند که در آن *همه‌ی* کلیدها باید توی "required"
// باشند، حتی آن‌هایی که می‌توانند null باشند؛ .optional() یعنی کلید از required حذف شود که
// در strict mode رد می‌شود («'required' is required to... Missing 'fiberG'»). .nullable()
// کلید را در required نگه می‌دارد ولی مقدارش را اجازه می‌دهد null باشد — دقیقاً چیزی که لازم داریم
const NivoCalItemSchema = z.object({
  nameFa: z.string().max(80),
  portionEstimate: z.string().max(80),
  calories: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(500),
  fatG: z.number().min(0).max(500),
  fiberG: z.number().min(0).max(200).nullable(),
  sugarG: z.number().min(0).max(500).nullable(),
});

const NivoCalResultSchema = z.object({
  isFood: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  items: z.array(NivoCalItemSchema).min(1).max(6),
  totalCalories: z.number().min(0).max(10_000),
  healthScore: z.enum(['healthy', 'moderate', 'unhealthy']),
  healthNotes: z.array(z.string().max(60)).max(3),
});

export type NivoCalResult = z.infer<typeof NivoCalResultSchema>;

// نکته‌ی مهم: باید تحت‌اللفظی کلمه‌ی "JSON" جایی در پیام‌ها ذکر شود — provider زیرساخت
// (وقتی generateObject روی این مدل به حالت json_object/response_format سقوط می‌کند) بدون آن
// خطای «Response input messages must contain the word 'json'...» می‌دهد؛ دقیقاً همان الزامی
// که system prompt کلاسیفایر در model-router.service.ts (classifyWithLLM) هم رعایتش می‌کند.
const SYSTEM_PROMPT = `تو یک متخصص تغذیه هستی که از روی عکس یک بشقاب غذا، آیتم‌های غذایی و مقدار تقریبی کالری و مواد مغذی آن‌ها را تخمین می‌زنی.
اگر عکس اصلاً غذا نبود، isFood را false بگذار (بقیه‌ی فیلدها را با بهترین حدس ممکن پر کن، مهم نیست).
اگر چند نوع غذا روی بشقاب بود، هرکدام را یک آیتم جداگانه در items بنویس.
totalCalories باید دقیقاً جمع calories همه‌ی آیتم‌ها باشد.
healthNotes حداکثر ۳ نکته‌ی خیلی کوتاه فارسی (هرکدام حداکثر ۶-۷ کلمه) درباره‌ی نقاط قوت/ضعف تغذیه‌ای غذا.
همه‌ی متن‌ها (nameFa، portionEstimate، healthNotes) باید فارسی باشند.
فقط یک JSON مطابق ساختار مشخص‌شده برگردان، بدون هیچ متن اضافه.`;

@Injectable()
export class NivoCalService {
  private readonly logger = new Logger(NivoCalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pricing: PricingService,
    private readonly chatConfig: ChatConfigService,
    private readonly credits: CreditsService,
    private readonly liaraKeyProvisioning: LiaraKeyProvisioningService,
    private readonly storage: StorageService,
  ) {}

  private async resolveApiKey(userId: string): Promise<string> {
    try {
      return await this.liaraKeyProvisioning.getApiKeyForUser(userId);
    } catch (err) {
      this.logger.warn(
        `Liara per-user key unavailable for user=${userId}, falling back to shared key: ${(err as Error).message}`,
      );
      return this.config.get<string>('LIARA_API_KEY')!;
    }
  }

  async scan(userId: string, rawImage: string, note?: string) {
    const creditConfig = await this.credits.getConfig();

    // پیش‌چک موجودی — قیمت این فیچر ثابت است (نه بر اساس usage واقعی)، پس دقیقاً همان عدد
    // قطعی قبل از هر فراخوانی provider چک می‌شود (docs/PRD-nivo-cal.md بخش ۵)
    const precheckToman =
      creditConfig.nivoCalScanCreditCost * creditConfig.tomanPerCredit;
    const walletBalance = await this.pricing.getWalletBalance(userId);
    if (walletBalance < precheckToman) {
      throw new BadRequestException(fa.nivoCal.insufficientCredits);
    }

    const dataUrl = await normalizeHeicDataUrl(rawImage);
    const chatConfig = await this.chatConfig.getConfig();
    validateChatImages([dataUrl], {
      maxCount: 1,
      maxSizeMb: chatConfig.maxImageSizeMb,
      allowedFormats: chatConfig.allowedImageFormats as string[],
    });
    const parsed = parseChatImageDataUrl(dataUrl)!;

    const apiKey = await this.resolveApiKey(userId);
    // supportsStructuredOutputs=true — این provider جدا (فقط برای NIVO_CAL_MODEL، یک مدل واقعی
    // OpenAI) response_format را به‌صورت json_schema سخت‌گیرانه (strict) به API واقعی می‌فرستد
    // به‌جای صرفاً یک دستور متنی «JSON برگردون»؛ بدون این، @ai-sdk/openai-compatible به‌طور پیش‌فرض
    // false فرض می‌کند و generateObject گاهی «response did not match schema» می‌دهد چون هیچ
    // تضمین سمت سرور برای پیروی از schema وجود ندارد. مستقل از provider مشترک model-router.service.ts.
    const provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey,
      supportsStructuredOutputs: true,
    });

    const visionMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: dataUrl },
        {
          type: 'text',
          text: note
            ? `یادداشت کاربر درباره‌ی این غذا: ${note}`
            : 'این غذا را تحلیل کن.',
        },
      ],
    };

    let result: NivoCalResult;
    let usage: { inputTokens?: number; outputTokens?: number } = {};
    try {
      const generated = await generateObject({
        model: provider(NIVO_CAL_MODEL),
        schema: NivoCalResultSchema,
        system: SYSTEM_PROMPT,
        messages: [visionMessage],
        abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      });
      result = generated.object;
      usage = generated.usage;
    } catch (err) {
      this.logger.error(
        `nivo-cal scan failed for user=${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(fa.nivoCal.scanFailed);
    }

    // گرد کردن اعداد سمت بک‌اند، بعد از دریافت نتیجه — فرانت هرگز عدد خام مدل را نمی‌بیند
    const roundedResult: NivoCalResult = {
      ...result,
      totalCalories: roundToNearest5(result.totalCalories),
      items: result.items.map((item) => ({
        ...item,
        calories: roundToNearest5(item.calories),
        proteinG: roundToNearest5(item.proteinG),
        carbsG: roundToNearest5(item.carbsG),
        fatG: roundToNearest5(item.fatG),
        fiberG: item.fiberG == null ? null : roundToNearest5(item.fiberG),
        sugarG: item.sugarG == null ? null : roundToNearest5(item.sugarG),
      })),
    };

    // بدون پیشوند پوشه (برخلاف چت که conversationId را پیشوند می‌کند) — کلید در یک پارامتر
    // مسیر تخت («images/:key») سرو می‌شود؛ اگر پیشوند اضافه شود، اسلش داخل کلید با روتینگ
    // Nest/Express جفت نمی‌شود. الگوی uploadInputImage در discovery-generation.service.ts هم دقیقاً همین است.
    const imageStorageKey = await this.storage.uploadImage(
      parsed.buffer,
      parsed.ext,
    );

    // قیمت ثابت (markup=1 مثل تایرهای ثابت «تبدیل عکس به پرامپت») — کسر فقط بعد از موفقیت
    const finalToman = precheckToman;
    const debited = await this.pricing.debitWallet(
      userId,
      finalToman,
      1,
      fa.nivoCal.scanDebitDescription,
      { feature: 'nivo-cal-scan', modelId: NIVO_CAL_MODEL },
    );
    if (!debited) {
      this.logger.error(
        `nivo-cal debitWallet: insufficient balance race for user=${userId}`,
      );
    }
    if (usage) {
      const { costToman, costUsdMicros } = await this.pricing.calcCost(
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        NIVO_CAL_MODEL,
      );
      this.pricing.trackCost(userId, costToman, costUsdMicros).catch(() => {});
    }

    const foodLog = await this.prisma.foodLog.create({
      data: {
        userId,
        imageStorageKey,
        note,
        resultJson: roundedResult,
        totalCalories: roundedResult.totalCalories,
        healthScore: roundedResult.healthScore,
        modelUsed: NIVO_CAL_MODEL,
        costToman: finalToman,
      },
    });

    return {
      id: foodLog.id,
      imageUrl: `/nivo-cal/images/${imageStorageKey}`,
      createdAt: foodLog.createdAt,
      ...roundedResult,
    };
  }

  async listLogs(userId: string, limit = 50) {
    const logs = await this.prisma.foodLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // هم‌شکل با پاسخ scan() (فیلدهای NivoCalResult flatten شده، نه nested زیر یک کلید result)
    // تا فرانت یک تایپ واحد (NivoCalLog) برای هر دو مصرف کند
    return logs.map((log) => ({
      id: log.id,
      imageUrl: `/nivo-cal/images/${log.imageStorageKey}`,
      note: log.note,
      createdAt: log.createdAt,
      ...(log.resultJson as unknown as NivoCalResult),
    }));
  }

  async getImage(userId: string, key: string) {
    const owned = await this.prisma.foodLog.findFirst({
      where: { userId, imageStorageKey: key },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException(fa.nivoCal.logNotFound);

    const ext = key.split('.').pop() ?? 'jpeg';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }
}
