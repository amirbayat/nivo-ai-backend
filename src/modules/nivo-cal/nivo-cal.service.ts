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
import { CreateNutritionProfileDto } from './dto/create-nutrition-profile.dto';
import { computeNutritionTargets } from './nivo-cal-targets';

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

  // برای اسکن‌های اشتباهی/تستی — چک مالکیت قبل از حذف، همون الگوی getImage بالا. حذف تصویر
  // از MinIO best-effort است؛ اگر شکست بخورد رکورد دیتابیس همچنان حذف‌شده می‌ماند (چیزی که
  // کاربر واقعاً می‌بیند)، فقط لاگ می‌شود
  async deleteLog(userId: string, id: string) {
    const log = await this.prisma.foodLog.findFirst({ where: { id, userId } });
    if (!log) throw new NotFoundException(fa.nivoCal.logNotFound);

    await this.prisma.foodLog.delete({ where: { id } });

    try {
      await this.storage.deleteObject(log.imageStorageKey);
    } catch (err) {
      this.logger.warn(
        `nivo-cal deleteLog: failed to remove image ${log.imageStorageKey}: ${(err as Error).message}`,
      );
    }

    return { success: true };
  }

  // docs/PRD-nivo-cal.md فاز ۲ — weightKg فقط برای اولین رکورد WeightLog استفاده می‌شود،
  // روی خود پروفایل ذخیره نمی‌شود (بخش ۴.۲). upsert چون کاربر باید بتواند بعداً پروفایلش
  // را ویرایش کند (مثلاً سطح فعالیت یا هدفش عوض شود) بدون رکورد تکراری.
  async createOrUpdateProfile(userId: string, dto: CreateNutritionProfileDto) {
    const goalPaceLevel = dto.goalPaceLevel ?? 2;
    const targets = computeNutritionTargets({
      gender: dto.gender,
      age: dto.age,
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      activityLevel: dto.activityLevel,
      goal: dto.goal,
      goalPaceLevel,
    });

    const data = {
      gender: dto.gender,
      age: dto.age,
      heightCm: dto.heightCm,
      activityLevel: dto.activityLevel,
      goal: dto.goal,
      goalPaceLevel,
      ...targets,
    };

    const profile = await this.prisma.nutritionProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    await this.prisma.weightLog.create({
      data: { userId, weightKg: dto.weightKg },
    });

    return profile;
  }

  async getProfile(userId: string) {
    return this.prisma.nutritionProfile.findUnique({ where: { userId } });
  }

  async logWeight(userId: string, weightKg: number) {
    const previous = await this.prisma.weightLog.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const entry = await this.prisma.weightLog.create({
      data: { userId, weightKg },
    });
    const deltaKg = previous
      ? Math.round((weightKg - previous.weightKg) * 10) / 10
      : null;
    return {
      id: entry.id,
      weightKg: entry.weightKg,
      createdAt: entry.createdAt,
      deltaKg,
    };
  }

  async getWeightHistory(userId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.weightLog.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
    const first = logs[0];
    const last = logs[logs.length - 1];
    const deltaKg =
      first && last && first.id !== last.id
        ? Math.round((last.weightKg - first.weightKg) * 10) / 10
        : 0;
    return {
      points: logs.map((l) => ({ date: l.createdAt, weightKg: l.weightKg })),
      deltaKg,
      periodDays: days,
    };
  }

  // استریک — تعداد روزهای متوالی که کاربر حداقل یک اسکن ثبت کرده، تا امروز (یا تا دیروز
  // اگر امروز هنوز اسکنی نداشته — استریک تا پایان امروز هنوز نشکسته است)
  private async computeStreak(userId: string): Promise<number> {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.foodLog.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const days = new Set(logs.map((l) => l.createdAt.toDateString()));

    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!days.has(cursor.toDateString())) {
      cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (days.has(cursor.toDateString())) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  async getDailySummary(userId: string) {
    const profile = await this.prisma.nutritionProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException(fa.nivoCal.profileNotFound);

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const todaysLogs = await this.prisma.foodLog.findMany({
      where: { userId, createdAt: { gte: startOfDay, lt: endOfDay } },
      orderBy: { createdAt: 'asc' },
    });

    const consumed = todaysLogs.reduce(
      (acc, log) => {
        const result = log.resultJson as unknown as NivoCalResult;
        if (!result.isFood) return acc;
        acc.calories += log.totalCalories;
        for (const item of result.items) {
          acc.proteinG += item.proteinG;
          acc.carbsG += item.carbsG;
          acc.fatG += item.fatG;
        }
        return acc;
      },
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );

    const meals = todaysLogs.map((log) => ({
      id: log.id,
      imageUrl: `/nivo-cal/images/${log.imageStorageKey}`,
      createdAt: log.createdAt,
      ...(log.resultJson as unknown as NivoCalResult),
    }));

    const [weightTrend, streakDays, weeklyAdherence] = await Promise.all([
      this.getWeightHistory(userId, 30),
      this.computeStreak(userId),
      this.getWeeklyAdherence(userId, profile.dailyCalorieTarget),
    ]);

    return {
      profile,
      consumed,
      remainingCalories: profile.dailyCalorieTarget - consumed.calories,
      meals,
      weightTrend,
      streakDays,
      weeklyAdherence,
    };
  }

  // «رعایت هفتگی» — هر روز از ۷ روز اخیر: هدف ثابت (پروفایل فعلی) در برابر کالری واقعاً
  // مصرف‌شده. روزهایی که اصلاً هیچ اسکنی نداشته‌اند noData هستند، نه under — چون صفر کالری
  // واقعی و «کاربر اصلاً از اپ استفاده نکرده» با این داده قابل تشخیص از هم نیستند، و نمایش
  // چنین روزی به‌عنوان «موفق» (سبز) گمراه‌کننده است
  private async getWeeklyAdherence(userId: string, dailyCalorieTarget: number) {
    const DAYS = 7;
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const since = new Date(
      startOfToday.getTime() - (DAYS - 1) * 24 * 60 * 60 * 1000,
    );

    const logs = await this.prisma.foodLog.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true, totalCalories: true, resultJson: true },
    });

    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const consumedByDay = new Map<string, number>();
    const hasLogByDay = new Set<string>();
    for (const log of logs) {
      const key = dayKey(log.createdAt);
      hasLogByDay.add(key);
      const result = log.resultJson as unknown as NivoCalResult;
      if (!result.isFood) continue;
      consumedByDay.set(key, (consumedByDay.get(key) ?? 0) + log.totalCalories);
    }

    const days: Array<{
      date: string;
      consumedCalories: number;
      targetCalories: number;
      status: 'under' | 'onTarget' | 'over' | 'noData';
    }> = [];

    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      const consumedCalories = consumedByDay.get(key) ?? 0;

      let status: 'under' | 'onTarget' | 'over' | 'noData';
      if (!hasLogByDay.has(key)) {
        status = 'noData';
      } else {
        const diff = consumedCalories - dailyCalorieTarget;
        status = diff > 30 ? 'over' : diff < -30 ? 'under' : 'onTarget';
      }

      days.push({
        date: key,
        consumedCalories,
        targetCalories: dailyCalorieTarget,
        status,
      });
    }

    return days;
  }
}
