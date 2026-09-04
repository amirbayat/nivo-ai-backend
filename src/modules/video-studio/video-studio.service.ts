import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  AiModelType,
  StudioProjectStatus,
  StudioShotVideoStatus,
  type AiModel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { StorageService } from '../../storage/storage.service';
import {
  ImageGenerationService,
  FACE_PRESERVATION_INSTRUCTION,
} from '../../common/services/image-generation.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { LiaraKeyProvisioningService } from '../liara/liara-key-provisioning.service';
import { VideoStudioConfigService } from '../video-studio-config/video-studio-config.service';
import {
  normalizeHeicDataUrl,
  parseChatImageDataUrl,
  validateChatImages,
} from '../../common/validators/chat-image.validator';
import { CreateVideoProjectDto } from './dto/create-project.dto';
import { SetVideoStudioModelsDto } from './dto/set-models.dto';
import { GenerateStoryboardDto } from './dto/generate-storyboard.dto';
import { UpdateShotDto } from './dto/update-shot.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { GenerateSimpleVideoDto } from './dto/generate-simple-video.dto';
import { fa } from '../../i18n/fa';

// مدل ثابت و ارزان برای ترجمه‌ی فارسی→انگلیسی + فیلتر محتوا (§۸.۵/۸.۹ PRD قدیمی) — یک
// فراخوانی سبک، جدا از سه مدل انتخابی کاربر (چت/عکس/ویدیو)؛ هزینه‌اش overhead داخلی حساب
// می‌شود و جدا از کاربر کسر نمی‌شود (دقیقاً مثل classifyWithLLM در model-router.service.ts)
const TRANSLATION_MODEL = 'openai/gpt-5-mini';

const TranslateAndModerateSchema = z.object({
  translatedPrompt: z
    .string()
    .describe('English translation of the input, suitable as an image/video generation prompt'),
  allowed: z
    .boolean()
    .describe(
      'false if the content requests real/famous people, explicit/violent content, or anything violating a reasonable content policy',
    ),
  reason: z.string().nullable(),
});

// دستور صریح کاربر — چت باید intent واقعی را از پیام آزاد کاربر تشخیص بدهد، نه یک اسکریپت
// ثابت driven-by-stage: «اگه خواست مدل رو تولید کنی عکسشو تولید کن، اگه خواست سناریو بدی
// سناریو بده، اگه خواست یه ضرب ویدیو بدی یه ضرب ویدیو بده». اگر پیام مبهم/عمومی بود، دستیار
// فقط پاسخ می‌دهد و suggestedActions پیشنهاد قدم بعدی را برای چیپ‌های قابل‌کلیک UI برمی‌گرداند
// («می‌خوای عکس مدل‌ها رو بسازم؟»).
const IntentSchema = z.object({
  intent: z.enum([
    'generate_character',
    'regenerate_character',
    'generate_storyboard',
    'generate_quick_video',
    'general',
  ]),
  reply: z
    .string()
    .describe('Short, friendly Persian reply to show the user in the chat'),
  extractedDetails: z
    .string()
    .nullable()
    .describe(
      'Persian text of any concrete new scenario/character/video details mentioned in this message, to feed into the generation step; null if the message has no new concrete details',
    ),
  suggestedActions: z
    .array(
      z.enum([
        'generate_character',
        'regenerate_character',
        'generate_storyboard',
        'generate_quick_video',
      ]),
    )
    .max(3)
    .describe('Only when intent="general" — up to 3 next-step suggestions to show as clickable chips'),
});

const StoryboardSchema = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().describe('Short Persian scene title'),
        scenario: z
          .string()
          .describe('English visual description of this scene, for an image/video generation model'),
      }),
    )
    .min(1)
    .max(10),
});

@Injectable()
export class VideoStudioService {
  private readonly logger = new Logger(VideoStudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly storage: StorageService,
    private readonly imageGen: ImageGenerationService,
    private readonly aiProvider: AiProviderService,
    private readonly liaraKeyProvisioning: LiaraKeyProvisioningService,
    private readonly videoStudioConfig: VideoStudioConfigService,
    @InjectQueue('studio-video-generation')
    private readonly videoQueue: Queue,
  ) {}

  // OpenRouter هنوز کلید اختصاصی-به‌ازای-کاربر ندارد (docs/PRD-openrouter-migration.md §۵.۱) —
  // دقیقاً همون الگوی discovery-generation.service.ts/resolveApiKey
  private async resolveApiKey(userId: string): Promise<string> {
    if (!this.aiProvider.supportsPerUserKeys) {
      return this.aiProvider.sharedApiKey;
    }
    try {
      return await this.liaraKeyProvisioning.getApiKeyForUser(userId);
    } catch (err) {
      this.logger.warn(
        `Liara per-user key unavailable for user=${userId}, falling back to shared key: ${(err as Error).message}`,
      );
      return this.aiProvider.sharedApiKey;
    }
  }

  private async resolveModel(
    modelType: AiModelType,
    preferredName?: string | null,
  ): Promise<AiModel> {
    if (preferredName) {
      const m = await this.prisma.aiModel.findUnique({
        where: { name: preferredName },
      });
      if (m && m.isActive && m.modelType === modelType && m.platform.includes(this.aiProvider.platform))
        return m;
    }
    const candidates = await this.prisma.aiModel.findMany({
      where: {
        isActive: true,
        modelType,
        platform: { has: this.aiProvider.platform },
      },
      orderBy: { sortOrder: 'asc' },
      take: 1,
    });
    if (!candidates.length)
      throw new BadRequestException(fa.videoStudio.characterGenerationFailed);
    return candidates[0];
  }

  private async getProjectOrThrow(userId: string, projectId: string) {
    const project = await this.prisma.studioProject.findUnique({
      where: { id: projectId },
      include: { characterOptions: true, shots: { orderBy: { order: 'asc' } } },
    });
    if (!project) throw new NotFoundException(fa.videoStudio.projectNotFound);
    if (project.userId !== userId) throw new ForbiddenException(fa.errors.forbidden);
    return project;
  }

  // ترجمه‌ی فارسی→انگلیسی + فیلتر محتوای سبک در یک فراخوانی (§۸.۵/۸.۹.۱ PRD قدیمی) — رد با
  // خطای مناسب اگر content policy را نقض کند؛ خروجی متن انگلیسی برای فرستادن به image/video API
  private async translateAndModerate(
    text: string,
    apiKey: string,
  ): Promise<string> {
    const provider = this.aiProvider.buildClient(apiKey);
    try {
      const { object } = await generateObject({
        model: provider(TRANSLATION_MODEL),
        schema: TranslateAndModerateSchema,
        system:
          'You translate Persian video/character descriptions into English generation prompts, and flag content policy violations (real/famous people impersonation, explicit/violent content). Return ONLY the JSON object.',
        prompt: text,
        abortSignal: AbortSignal.timeout(15_000),
      });
      if (!object.allowed) {
        throw new BadRequestException(fa.videoStudio.contentRejected);
      }
      return object.translatedPrompt;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `translateAndModerate failed, falling back to raw text: ${(err as Error).message}`,
      );
      return text;
    }
  }

  async createProject(userId: string, dto: CreateVideoProjectDto) {
    return this.prisma.studioProject.create({
      data: {
        userId,
        initialPrompt: dto.initialPrompt,
        visualStyle: dto.visualStyle ?? null,
      },
    });
  }

  async listMyProjects(userId: string) {
    return this.prisma.studioProject.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getProject(userId: string, projectId: string) {
    return this.getProjectOrThrow(userId, projectId);
  }

  async setModels(
    userId: string,
    projectId: string,
    dto: SetVideoStudioModelsDto,
  ) {
    await this.getProjectOrThrow(userId, projectId);
    return this.prisma.studioProject.update({
      where: { id: projectId },
      data: dto,
    });
  }

  // شروع + بازطراحی هر دو از همین متد رد می‌شوند (کنترلر دو مسیر جدا صدا می‌زند) — سقف
  // بازطراحی از تعداد گزینه‌های تولیدشده‌ی قبلی این پروژه محاسبه می‌شود، نه یک شمارنده‌ی جدا
  async generateCharacterOptions(userId: string, projectId: string) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const config = await this.videoStudioConfig.getConfig();
    const n = config.characterOptionCount;

    const existingBatches = Math.floor(
      project.characterOptions.length / Math.max(n, 1),
    );
    if (existingBatches >= config.maxCharacterRegeneratesPerProject) {
      throw new BadRequestException(fa.videoStudio.tooManyRegenerates);
    }

    const apiKey = await this.resolveApiKey(userId);
    const model = await this.resolveModel(AiModelType.IMAGE_GEN, project.photoModelId);

    const translated = await this.translateAndModerate(
      [project.initialPrompt, project.visualStyle].filter(Boolean).join(' — '),
      apiKey,
    );
    const characterPrompt = [
      'Full character portrait design for a video project, square framing, neutral studio background.',
      translated,
    ].join('\n\n');

    // پیش‌چک موجودی — هزینه‌ی هر ۴ (یا هر عددی که config بگوید) عکس قبل از تولید تخمین زده
    // می‌شود، طبق تصمیم صریح کاربر که هزینه‌ی هر تعداد عکسی که تولید می‌شود کسر شود
    const perImageEstimate = model.imageGenFlatPriceUnit
      ? await this.pricing.calcImageGenFlatCost(model)
      : await this.pricing.calcImageGenCost(
          { textInputTokens: 300, imageInputTokens: 0, outputTokens: 1500 },
          model,
        );
    const walletBalance = await this.pricing.getWalletBalance(userId);
    if (walletBalance < perImageEstimate.costToman * n) {
      throw new BadRequestException(fa.videoStudio.insufficientCredits);
    }

    const results = await Promise.allSettled(
      Array.from({ length: n }).map(() =>
        this.imageGen.generateImage({
          modelId: model.name,
          prompt: characterPrompt,
          apiKey,
          size: model.imageGenSize ?? '1024x1024',
          quality: model.imageGenQuality ?? undefined,
        }),
      ),
    );

    const created: { id: string; imageKey: string }[] = [];
    let totalToman = 0;
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        this.logger.warn(
          `character option generation failed for project=${projectId}: ${result.reason}`,
        );
        continue;
      }
      const costCalc = model.imageGenFlatPriceUnit
        ? await this.pricing.calcImageGenFlatCost(model)
        : await this.pricing.calcImageGenCost(result.value.usage, model);
      totalToman += costCalc.costToman;
      const buffer = Buffer.from(result.value.base64, 'base64');
      const imageKey = await this.storage.uploadImage(buffer, 'png', projectId);
      const option = await this.prisma.studioCharacterOption.create({
        data: { projectId, imageKey },
      });
      created.push({ id: option.id, imageKey: option.imageKey });
    }

    if (!created.length) {
      throw new BadRequestException(fa.videoStudio.characterGenerationFailed);
    }

    // کسر واقعی فقط برای عکس‌هایی که واقعاً موفق شدند — طبق تصمیم کاربر «هزینه‌ی هر تعداد
    // عکسی که تولید می‌شود کسر بشه» (نه هزینه‌ی کامل N حتی اگر بعضی fail شده باشند)
    if (totalToman > 0) {
      const debited = await this.pricing.debitWallet(
        userId,
        totalToman,
        1,
        `طراحی کاراکتر ویدیو — ${projectId}`,
        { feature: 'video-studio-character', projectId, count: created.length },
      );
      if (!debited)
        this.logger.error(
          `video-studio character debitWallet: insufficient balance race for user=${userId} project=${projectId}`,
        );
    }

    return this.getProjectOrThrow(userId, projectId);
  }

  async selectCharacter(userId: string, projectId: string, optionId: string) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const option = project.characterOptions.find((o) => o.id === optionId);
    if (!option)
      throw new NotFoundException(fa.videoStudio.characterOptionNotFound);

    await this.prisma.$transaction([
      this.prisma.studioCharacterOption.updateMany({
        where: { projectId },
        data: { selected: false },
      }),
      this.prisma.studioCharacterOption.update({
        where: { id: optionId },
        data: { selected: true },
      }),
      this.prisma.studioProject.update({
        where: { id: projectId },
        data: { status: StudioProjectStatus.CHARACTER_SELECTED },
      }),
    ]);

    return this.getProjectOrThrow(userId, projectId);
  }

  async generateStoryboard(
    userId: string,
    projectId: string,
    dto: GenerateStoryboardDto,
  ) {
    const project = await this.getProjectOrThrow(userId, projectId);
    // انتخاب کاراکتر اختیاری است — کاربر ممکن است اصلاً نخواهد کاراکتر بسازد و مستقیم برود
    // سراغ سناریو (طبق درخواست صریح کاربر: تشخیص intent، نه اجبار به یک مسیر خطی ثابت).
    // وقتی کاراکتری انتخاب نشده، صحنه‌ها بدون تصویر مرجع (و بدون دستور حفظ چهره) تولید می‌شوند.
    const selectedCharacter = project.characterOptions.find((o) => o.selected);

    const apiKey = await this.resolveApiKey(userId);
    const chatModel = await this.resolveModel(AiModelType.CHAT, project.chatModelId);
    const photoModel = await this.resolveModel(AiModelType.IMAGE_GEN, project.photoModelId);
    const provider = this.aiProvider.buildClient(apiKey);

    const translatedDetails = await this.translateAndModerate(
      dto.details,
      apiKey,
    );

    let scenes: z.infer<typeof StoryboardSchema>['scenes'];
    let chatUsage: { inputTokens?: number; outputTokens?: number } = {};
    try {
      const generated = await generateObject({
        model: provider(chatModel.name),
        schema: StoryboardSchema,
        system:
          'You break a short video concept into a numbered storyboard of distinct scenes/shots. Each scene needs a short Persian title and a detailed English visual scenario (setting, action, camera angle) for an image generation model. Return ONLY the JSON object.',
        prompt: `${project.initialPrompt}\n\n${translatedDetails}`,
        abortSignal: AbortSignal.timeout(30_000),
      });
      scenes = generated.object.scenes;
      chatUsage = generated.usage;
    } catch (err) {
      this.logger.error(
        `storyboard generation failed for project=${projectId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(fa.videoStudio.storyboardGenerationFailed);
    }

    const characterBuffer = selectedCharacter
      ? await this.storage.downloadImage(selectedCharacter.imageKey)
      : null;

    let totalToman = (
      await this.pricing.calcCost(
        chatUsage.inputTokens ?? 0,
        chatUsage.outputTokens ?? 0,
        chatModel.name,
      )
    ).costToman;

    const createdShots: { order: number; title: string; previewImageKey: string | null }[] =
      [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const scenePrompt = characterBuffer
        ? [
            'Storyboard frame for a video scene, keep the character appearance identical to the reference image.',
            scene.scenario,
            FACE_PRESERVATION_INSTRUCTION,
          ].join('\n\n')
        : ['Storyboard frame for a video scene.', scene.scenario].join('\n\n');
      let previewImageKey: string | null = null;
      try {
        const result = characterBuffer
          ? await this.imageGen.editImage({
              modelId: photoModel.name,
              prompt: scenePrompt,
              images: [characterBuffer],
              apiKey,
              size: photoModel.imageGenSize ?? project.imageAspectRatio ?? undefined,
              quality: photoModel.imageGenQuality ?? undefined,
            })
          : await this.imageGen.generateImage({
              modelId: photoModel.name,
              prompt: scenePrompt,
              apiKey,
              size: photoModel.imageGenSize ?? project.imageAspectRatio ?? undefined,
              quality: photoModel.imageGenQuality ?? undefined,
            });
        const costCalc = photoModel.imageGenFlatPriceUnit
          ? await this.pricing.calcImageGenFlatCost(photoModel)
          : await this.pricing.calcImageGenCost(result.usage, photoModel);
        totalToman += costCalc.costToman;
        const buffer = Buffer.from(result.base64, 'base64');
        previewImageKey = await this.storage.uploadImage(buffer, 'png', projectId);
      } catch (err) {
        this.logger.warn(
          `storyboard scene image failed for project=${projectId} scene=${i}: ${(err as Error).message}`,
        );
      }

      const shot = await this.prisma.studioShot.create({
        data: {
          projectId,
          order: i,
          title: scene.title,
          scenario: scene.scenario,
          previewImageKey,
          audioEnabled: (await this.videoStudioConfig.getConfig()).defaultAudioEnabled,
        },
      });
      createdShots.push({
        order: shot.order,
        title: shot.title,
        previewImageKey: shot.previewImageKey,
      });
    }

    if (totalToman > 0) {
      const debited = await this.pricing.debitWallet(
        userId,
        totalToman,
        1,
        `استوری‌برد ویدیو — ${projectId}`,
        { feature: 'video-studio-storyboard', projectId, sceneCount: createdShots.length },
      );
      if (!debited)
        this.logger.error(
          `video-studio storyboard debitWallet: insufficient balance race for user=${userId} project=${projectId}`,
        );
    }

    await this.prisma.studioProject.update({
      where: { id: projectId },
      data: { status: StudioProjectStatus.STORYBOARD_READY },
    });

    return this.getProjectOrThrow(userId, projectId);
  }

  async updateShot(
    userId: string,
    projectId: string,
    shotId: string,
    dto: UpdateShotDto,
  ) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) throw new NotFoundException(fa.videoStudio.shotNotFound);

    return this.prisma.studioShot.update({
      where: { id: shotId },
      data: dto,
    });
  }

  // preflight (چک سقف/موجودی) + queue کردن job — کسر واقعی و رندر در پردازشگر صف انجام
  // می‌شود (queue/processors/studio-video-generation.processor.ts)، نه اینجا
  async requestShotVideo(userId: string, projectId: string, shotId: string) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) throw new NotFoundException(fa.videoStudio.shotNotFound);
    if (
      shot.videoStatus === StudioShotVideoStatus.PENDING ||
      shot.videoStatus === StudioShotVideoStatus.PROCESSING
    ) {
      throw new BadRequestException(fa.videoStudio.videoAlreadyProcessing);
    }

    const config = await this.videoStudioConfig.getConfig();

    const activeJobsCount = await this.prisma.studioShot.count({
      where: {
        project: { userId },
        videoStatus: {
          in: [StudioShotVideoStatus.PENDING, StudioShotVideoStatus.PROCESSING],
        },
      },
    });
    if (activeJobsCount >= config.maxConcurrentVideoJobsPerUser) {
      throw new BadRequestException(fa.videoStudio.tooManyConcurrentJobs);
    }

    if (config.maxVideoGenPerDayPerUser != null) {
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const todayCount = await this.prisma.studioShot.count({
        where: {
          project: { userId },
          createdAt: { gte: since },
          videoStatus: { not: StudioShotVideoStatus.NOT_STARTED },
        },
      });
      if (todayCount >= config.maxVideoGenPerDayPerUser) {
        throw new BadRequestException(fa.videoStudio.dailyVideoLimitReached);
      }
    }

    const apiKey = await this.resolveApiKey(userId);
    const translatedScenario = await this.translateAndModerate(
      shot.scenario,
      apiKey,
    );
    if (translatedScenario !== shot.scenario) {
      await this.prisma.studioShot.update({
        where: { id: shotId },
        data: { scenario: translatedScenario },
      });
    }

    const videoModel = await this.resolveModel(
      AiModelType.VIDEO_GEN,
      project.videoModelId,
    );
    const durationSec = videoModel.videoGenSupportedDurationsSec[0] ?? 4;
    const estimate = await this.pricing.calcVideoGenCost(
      videoModel,
      durationSec,
      shot.audioEnabled,
    );
    const walletBalance = await this.pricing.getWalletBalance(userId);
    if (walletBalance < estimate.costToman) {
      throw new BadRequestException(fa.videoStudio.insufficientCredits);
    }

    await this.prisma.studioShot.update({
      where: { id: shotId },
      data: { videoStatus: StudioShotVideoStatus.PENDING, videoJobId: null },
    });

    await this.videoQueue.add(
      'render',
      { shotId },
      { attempts: 1, removeOnComplete: true, removeOnFail: false },
    );

    return this.prisma.studioShot.findUnique({ where: { id: shotId } });
  }

  async getShotVideoStatus(userId: string, projectId: string, shotId: string) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) throw new NotFoundException(fa.videoStudio.shotNotFound);
    return {
      videoStatus: shot.videoStatus,
      videoKey: shot.videoKey,
      creditCost: shot.creditCost,
    };
  }

  async listMessages(userId: string, projectId: string) {
    await this.getProjectOrThrow(userId, projectId);
    return this.prisma.studioMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // فاز اول ساده‌شده (دستور صریح کاربر ۱۴۰۵-۰۶-۱۳): متن + عکس اختیاری + مدل + سایز → مستقیم یک
  // ویدیو، بدون رفتن از لایه‌ی چت/intent classification (که با خطای provider ناپایدار بود). یک
  // پروژه‌ی سبک می‌سازد و بقیه‌ی مسیر را می‌سپارد به requestShotVideo همین سرویس (preflight
  // کیف‌پول + صف رندر، بدون تکرار آن منطق اینجا).
  async generateSimpleVideo(userId: string, dto: GenerateSimpleVideoDto) {
    const videoModel = await this.prisma.aiModel.findUnique({
      where: { name: dto.videoModelId },
    });
    if (
      !videoModel ||
      !videoModel.isActive ||
      videoModel.modelType !== AiModelType.VIDEO_GEN
    ) {
      throw new BadRequestException(fa.videoStudio.invalidVideoModel);
    }

    const config = await this.videoStudioConfig.getConfig();
    const project = await this.prisma.studioProject.create({
      data: {
        userId,
        initialPrompt: dto.prompt,
        videoModelId: dto.videoModelId,
        videoAspectRatio: dto.videoAspectRatio,
      },
    });
    const shot = await this.prisma.studioShot.create({
      data: {
        projectId: project.id,
        order: 0,
        title: dto.prompt.slice(0, 40),
        scenario: dto.prompt,
        previewImageKey: dto.imageKey ?? null,
        audioEnabled: dto.audioEnabled ?? config.defaultAudioEnabled,
      },
    });
    await this.requestShotVideo(userId, project.id, shot.id);
    return { projectId: project.id, shotId: shot.id };
  }

  // یک شات مستقیم از متن خام کاربر (بدون طراحی کاراکتر/استوری‌برد) — «یه ضرب ویدیو» طبق
  // درخواست کاربر. requestShotVideo بعدش همان مسیر preflight/صف معمولی را انجام می‌دهد.
  // imageKey اختیاری («این عکس رو برام ویدیو کن») همان‌طور روی previewImageKey می‌نشیند که
  // برای استوری‌برد هم استفاده می‌شود — پردازشگر صف از قبل این فیلد را به‌عنوان
  // referenceImage به submitVideoJob پاس می‌دهد (studio-video-generation.processor.ts)
  private async generateQuickVideo(
    userId: string,
    projectId: string,
    prompt: string,
    imageKey?: string,
  ) {
    const project = await this.getProjectOrThrow(userId, projectId);
    const config = await this.videoStudioConfig.getConfig();
    const nextOrder = project.shots.length
      ? Math.max(...project.shots.map((s) => s.order)) + 1
      : 0;
    const shot = await this.prisma.studioShot.create({
      data: {
        projectId,
        order: nextOrder,
        title: prompt.slice(0, 40),
        scenario: prompt,
        previewImageKey: imageKey ?? null,
        audioEnabled: config.defaultAudioEnabled,
      },
    });
    await this.requestShotVideo(userId, projectId, shot.id);
  }

  // آپلود عکس مرجع برای «این عکس رو برام ویدیو کن» — قبل از sendMessage صدا زده می‌شود؛
  // دقیقاً الگوی DiscoveryGenerationService.uploadInputImage، فقط بدون وابستگی به ChatConfig
  // چون این یک محدودیت ثابت و کوچک است، نه یک تنظیم قابل‌ادمین
  async uploadImage(rawDataUrl: string): Promise<{ key: string }> {
    const dataUrl = await normalizeHeicDataUrl(rawDataUrl);
    validateChatImages([dataUrl], {
      maxCount: 1,
      maxSizeMb: 8,
      allowedFormats: ['jpeg', 'jpg', 'png', 'webp'],
    });
    const parsed = parseChatImageDataUrl(dataUrl)!;
    const key = await this.storage.uploadImage(parsed.buffer, parsed.ext);
    return { key };
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      if (typeof response === 'object' && response && 'message' in response) {
        return String((response as { message: unknown }).message);
      }
    }
    return fa.errors.internal;
  }

  // نقطه‌ی ورود گفتگوی واقعی — طبق درخواست صریح کاربر: intent را از متن آزاد تشخیص بده،
  // یک مسیر خطی ثابت (کاراکتر→استوری‌برد→ویدیو) را اجبار نکن. اگر کاربر مستقیم خواست
  // «مدل‌ها رو بساز» فقط عکس تولید می‌شود، اگر خواست سناریو فقط سناریو، اگر خواست یک ویدیوی
  // مستقیم («یه ضرب») مستقیم همان یک ویدیو رندر می‌شود. پیام مبهم/عمومی → فقط پاسخ +
  // suggestedActions (چیپ‌های پیشنهادی UI)، بدون اجرای هیچ اکشنی.
  async sendMessage(userId: string, projectId: string, dto: SendMessageDto) {
    const project = await this.getProjectOrThrow(userId, projectId);
    await this.prisma.studioMessage.create({
      data: { projectId, role: 'user', content: dto.content },
    });

    const recentMessages = await this.prisma.studioMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const history = recentMessages
      .reverse()
      .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.content}`)
      .join('\n');

    const stateSummary = [
      `مرحله‌ی فعلی پروژه: ${project.status}`,
      `تعداد گزینه‌ی کاراکتر تولیدشده: ${project.characterOptions.length}`,
      `کاراکتر انتخاب‌شده: ${project.characterOptions.some((o) => o.selected) ? 'بله' : 'خیر'}`,
      `تعداد صحنه‌ی استوری‌برد: ${project.shots.length}`,
    ].join('\n');

    const apiKey = await this.resolveApiKey(userId);
    const chatModel = await this.resolveModel(AiModelType.CHAT, project.chatModelId);
    const provider = this.aiProvider.buildClient(apiKey);

    let classification: z.infer<typeof IntentSchema>;
    try {
      const { object } = await generateObject({
        model: provider(chatModel.name),
        schema: IntentSchema,
        system: `تو دستیار استودیوی تولید ویدیوی نیوو هستی. کاربر در یک گفتگوی پیوسته (بدون مراحل اجباری) دارد ویدیو می‌سازد: می‌تواند کاراکتر طراحی کند، سناریو/استوری‌برد بسازد، یا مستقیم یک ویدیوی کوتاه از یک ایده بخواهد — به هر ترتیبی که خودش بخواهد، نه لزوماً به همین ترتیب.
پیام کاربر را دقیق بخوان و intent واقعی‌اش را تشخیص بده:
- "generate_character": صراحتاً خواسته کاراکتر/مدل/چهره طراحی یا تولید شود (اولین‌بار).
- "regenerate_character": از قبل کاراکتر تولید شده و کاربر خواسته دوباره/متفاوت طراحی شود.
- "generate_storyboard": خواسته سناریو/داستان/استوری‌برد نوشته یا صحنه‌بندی شود (با یا بدون کاراکتر انتخاب‌شده).
- "generate_quick_video": خواسته مستقیم و فوری یک ویدیوی کوتاه از یک توصیف ساده ساخته شود، بدون طی مراحل کاراکتر/استوری‌برد.
- "general": پیام یک سؤال/گفتگوی عمومی است یا آنقدر مبهم است که نمی‌شود مطمئن به یکی از موارد بالا رسید — فقط پاسخ بده و در suggestedActions قدم بعدی منطقی را (با توجه به وضعیت فعلی پروژه) پیشنهاد کن.
reply را همیشه فارسی، کوتاه و دوستانه بنویس. اگر intent مبهم است، در reply صریح بپرس («می‌خوای برات عکس مدل‌ها رو بسازم یا مستقیم بریم سراغ سناریو؟»).`,
        prompt: `وضعیت فعلی پروژه:\n${stateSummary}\n\nایده‌ی اولیه‌ی پروژه: ${project.initialPrompt}\n\nگفتگوی اخیر:\n${history}\n\nپیام جدید کاربر: ${dto.content}${dto.imageKey ? '\n\n(کاربر یک عکس هم ضمیمه کرده — اگر پیام صراحتاً یا ضمنی خواسته از همین عکس ویدیو ساخته شود، intent را generate_quick_video بگذار.)' : ''}`,
        abortSignal: AbortSignal.timeout(20_000),
      });
      classification = object;
    } catch (err) {
      this.logger.warn(
        `intent classification failed for project=${projectId}: ${(err as Error).message}`,
      );
      classification = {
        intent: 'general',
        reply: 'متوجه نشدم — می‌تونی واضح‌تر بگی چی می‌خوای بسازیم؟',
        extractedDetails: null,
        suggestedActions: [],
      };
    }

    let actionError: string | null = null;
    try {
      switch (classification.intent) {
        case 'generate_character':
        case 'regenerate_character':
          await this.generateCharacterOptions(userId, projectId);
          break;
        case 'generate_storyboard':
          await this.generateStoryboard(userId, projectId, {
            details: classification.extractedDetails ?? dto.content,
          });
          break;
        case 'generate_quick_video':
          await this.generateQuickVideo(
            userId,
            projectId,
            classification.extractedDetails ?? dto.content,
            dto.imageKey,
          );
          break;
        case 'general':
          break;
      }
    } catch (err) {
      actionError = this.extractErrorMessage(err);
    }

    const assistantContent = actionError
      ? `${classification.reply}\n\n⚠️ ${actionError}`
      : classification.reply;
    const assistantMessage = await this.prisma.studioMessage.create({
      data: {
        projectId,
        role: 'assistant',
        content: assistantContent,
        intent: classification.intent,
        suggestedActions: classification.suggestedActions ?? [],
      },
    });

    return {
      message: assistantMessage,
      project: await this.getProjectOrThrow(userId, projectId),
    };
  }

  // سرو کردن عکس/ویدیوی این پروژه از پشت JwtGuard + چک مالکیت — دقیقاً الگوی
  // discovery-generation.service.ts/getImage (بدون presigned URL عمومی)
  async getAsset(
    userId: string,
    key: string,
  ): Promise<{ buffer: Buffer; ext: string }> {
    const owned =
      (await this.prisma.studioCharacterOption.findFirst({
        where: { imageKey: key, project: { userId } },
        select: { id: true },
      })) ??
      (await this.prisma.studioShot.findFirst({
        where: {
          OR: [{ previewImageKey: key }, { videoKey: key }],
          project: { userId },
        },
        select: { id: true },
      }));
    if (!owned) throw new NotFoundException(fa.errors.notFound);

    const ext = key.split('.').pop() ?? 'png';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, ext };
  }
}
