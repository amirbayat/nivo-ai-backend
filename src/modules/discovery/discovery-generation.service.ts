import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type { UserModelMessage } from 'ai';
import {
  AiModelType,
  CreativeGenerationStatus,
  CreativeOutputType,
  CreativePromptReviewStatus,
  CreativePromptSourceType,
  CreativeSegment,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { ChatConfigService } from '../chat-config/chat-config.service';
import { LiaraKeyProvisioningService } from '../liara/liara-key-provisioning.service';
import { StorageService } from '../../storage/storage.service';
import { ImageGenerationService } from '../../common/services/image-generation.service';
import { CreditsService } from '../credits/credits.service';
import { GenerateCreativeDto } from './dto/generate-creative.dto';
import { GenerateAnonCreativeDto } from './dto/generate-anon-creative.dto';
import { fa } from '../../i18n/fa';
import {
  mimeTypeForExt,
  parseChatImageDataUrl,
  validateChatImages,
} from '../../common/validators/chat-image.validator';

// موتور تولید دیسکاوری — بخش ۵.۴ سند فنی. هم عکس هم متن از یک مسیر مشترک رد می‌شوند:
// انتخاب سبک → مونتاژ context (ChatConfig سراسری → Project اختیاری → CreativePrompt) →
// تولید → کسر نیوو *فقط بعد از موفقیت* (بخش ۳ — تولید fail‌شده نیوو کسر نمی‌کند).
@Injectable()
export class DiscoveryGenerationService {
  private readonly logger = new Logger(DiscoveryGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pricing: PricingService,
    private readonly chatConfig: ChatConfigService,
    private readonly liaraKeyProvisioning: LiaraKeyProvisioningService,
    private readonly storage: StorageService,
    private readonly imageGen: ImageGenerationService,
    private readonly credits: CreditsService,
  ) {}

  async listCatalog(params: {
    outputType?: CreativeOutputType;
    segment?: CreativeSegment;
    trending?: boolean;
    categoryId?: string;
    sort?: 'newest' | 'cheapest' | 'priciest' | 'sortOrder';
  }) {
    const orderBy =
      params.sort === 'newest'
        ? [{ createdAt: 'desc' as const }]
        : params.sort === 'cheapest'
          ? [{ creditCost: 'asc' as const }]
          : params.sort === 'priciest'
            ? [{ creditCost: 'desc' as const }]
            : [{ sortOrder: 'asc' as const }, { createdAt: 'desc' as const }];

    return this.prisma.creativePrompt.findMany({
      where: {
        isActive: true,
        ...(params.outputType ? { outputType: params.outputType } : {}),
        ...(params.segment ? { segment: params.segment } : {}),
        ...(params.trending ? { isTrending: true } : {}),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      },
      orderBy,
      // contextMd/userPromptTemplate/preferredModel عمداً برای کاربر نمایش داده نمی‌شوند — این‌ها
      // «دستور پشت‌صحنه‌»ی ادمین هستند، دقیقاً مثل Plan.contextMd که در v1 هم به فرانت لو نمی‌رود
      select: {
        id: true,
        title: true,
        outputType: true,
        segment: true,
        categoryId: true,
        description: true,
        exampleImageUrl: true,
        aspectRatio: true,
        requiresUserImage: true,
        creditCost: true,
        isTrending: true,
        tags: true,
        sortOrder: true,
      },
    });
  }

  // درخت دسته‌بندی فعال — برای سایدبار استودیوی محتوا در فرانت
  async listCategories() {
    return this.prisma.creativeCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, parentId: true, sortOrder: true },
    });
  }

  async gallery(userId: string, projectId?: string) {
    return this.prisma.creativeGeneration.findMany({
      where: {
        userId,
        status: CreativeGenerationStatus.SUCCEEDED,
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        prompt: { select: { title: true, outputType: true } },
        project: { select: { name: true } },
      },
    });
  }

  // سرو کردن عکس خروجی تولید دیسکاوری از پشت JwtGuard — دقیقاً هم‌الگوی
  // ConversationsService.getImage (چک مالکیت قبل از serve، نه presigned URL عمومی)
  async getImage(
    userId: string,
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const generation = await this.prisma.creativeGeneration.findFirst({
      where: { outputImageKey: key, userId },
      select: { id: true },
    });
    if (!generation) throw new NotFoundException(fa.errors.notFound);

    const ext = key.split('.').pop() ?? 'png';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // آپلود تک‌عکس ورودی کاربر برای سبک‌های requiresUserImage=true — قبل از generate صدا زده
  // می‌شود؛ همون محدودیت‌های فرمت/حجم/magic-bytes چت (ChatConfig ادمین) رو رعایت می‌کند تا یک
  // مسیر اعتبارسنجی دوباره (با ریسک واگرایی) نوشته نشود
  async uploadInputImage(dataUrl: string): Promise<{ key: string }> {
    const chatConfig = await this.chatConfig.getConfig();
    validateChatImages([dataUrl], {
      maxCount: 1,
      maxSizeMb: chatConfig.maxImageSizeMb,
      allowedFormats: chatConfig.allowedImageFormats as string[],
    });
    // validateChatImages بالا همین دیتا-یو‌آرال رو با parseChatImageDataUrl چک کرده، پس اینجا حتماً null نیست
    const parsed = parseChatImageDataUrl(dataUrl)!;
    const key = await this.storage.uploadImage(parsed.buffer, parsed.ext);
    return { key };
  }

  // «درخواست سبک/فیچر جدید» — بخش ۵.۵ سند فنی؛ اگر مخاطبی سبک موردنظرش را در دیسکاوری پیدا نکرد
  async createPromptRequest(
    userId: string,
    dto: {
      promptId?: string;
      title: string;
      description: string;
      platform?: CreativeSegment;
      referenceUrl?: string;
    },
  ) {
    await this.prisma.creativePromptRequest.create({
      data: {
        userId,
        promptId: dto.promptId ?? null,
        title: dto.title,
        description: dto.description,
        platform: dto.platform ?? null,
        referenceUrl: dto.referenceUrl ?? null,
      },
    });
    return { message: fa.discovery.requestReceived };
  }

  async generate(userId: string, dto: GenerateCreativeDto) {
    const prompt = await this.prisma.creativePrompt.findUnique({
      where: { id: dto.promptId },
    });
    // یک ردیف USER_EXTRACTED هنوز تاییدنشده (isActive=false) فقط برای همون کاربری که آن
    // را ساخته (submittedByUserId) قابل‌استفاده است — تا زمان بررسی ادمین. اگر رد شده
    // باشد (REJECTED) حتی برای خودش هم دیگر کار نمی‌کند.
    const usableByOwner =
      !!prompt &&
      !prompt.isActive &&
      prompt.sourceType === CreativePromptSourceType.USER_EXTRACTED &&
      prompt.submittedByUserId === userId &&
      prompt.reviewStatus !== CreativePromptReviewStatus.REJECTED;
    if (!prompt || (!prompt.isActive && !usableByOwner))
      throw new NotFoundException(fa.discovery.promptNotFound);
    if (prompt.requiresUserImage && !dto.inputImageKeys?.length) {
      throw new BadRequestException(fa.discovery.userImageRequired);
    }

    let project: { contextMd: string; userId: string } | null = null;
    if (dto.projectId) {
      project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });
      if (!project || project.userId !== userId)
        throw new ForbiddenException(fa.errors.forbidden);
    }

    // پیش‌بررسی موجودی — قبل از صرف هزینه‌ی واقعی تولید (preflight)؛ کسر واقعی فقط بعد از موفقیت است
    const creditConfig = await this.credits.getConfig();
    const walletBalance = await this.pricing.getWalletBalance(userId);
    const requiredToman = prompt.creditCost * creditConfig.tomanPerCredit;
    if (walletBalance < requiredToman)
      throw new BadRequestException(fa.discovery.insufficientCredits);

    const systemPrompt = await this.buildSystemPrompt(
      prompt.contextMd,
      project?.contextMd,
    );
    const finalUserPrompt = this.fillTemplate(
      prompt.userPromptTemplate,
      dto.userInput ?? '',
    );

    try {
      if (prompt.outputType === CreativeOutputType.IMAGE) {
        return await this.generateImageOutput(
          userId,
          prompt,
          dto,
          systemPrompt,
          finalUserPrompt,
          requiredToman,
        );
      }
      return await this.generateTextOutput(
        userId,
        prompt,
        dto,
        systemPrompt,
        finalUserPrompt,
        requiredToman,
      );
    } catch (err) {
      this.logger.error(
        `discovery generation failed for user=${userId} prompt=${prompt.id}`,
        err as Error,
      );
      await this.prisma.creativeGeneration.create({
        data: {
          userId,
          promptId: prompt.id,
          projectId: dto.projectId ?? null,
          outputType: prompt.outputType,
          creditCost: prompt.creditCost,
          costToman: 0,
          status: CreativeGenerationStatus.FAILED,
          failureReason: (err as Error).message?.slice(0, 500) ?? 'unknown',
        },
      });
      throw new BadRequestException(fa.discovery.generationFailed);
    }
  }

  // امتحان رایگان یک‌باره‌ی مهمان — همون خط لوله‌ی generate() ولی بدون کاربر واقعی: بدون
  // preflight/کسر موجودی، بدون Project، از کلید مشترک Liara (نه resolveApiKey(userId))، و
  // کاملاً ephemeral (نه CreativeGeneration، نه آپلود عکس خروجی در MinIO) — نتیجه فقط در پاسخ
  // API برمی‌گردد. gate یک‌بارمصرف (claim/revert) در DiscoveryAnonService است، نه اینجا.
  async generateAnonPreview(dto: GenerateAnonCreativeDto): Promise<{
    outputType: CreativeOutputType;
    outputText?: string;
    outputImageDataUrl?: string;
  }> {
    const prompt = await this.prisma.creativePrompt.findUnique({
      where: { id: dto.promptId },
    });
    if (!prompt || !prompt.isActive)
      throw new NotFoundException(fa.discovery.promptNotFound);
    if (prompt.requiresUserImage && !dto.inputImageKeys?.length) {
      throw new BadRequestException(fa.discovery.userImageRequired);
    }

    const systemPrompt = await this.buildSystemPrompt(prompt.contextMd);
    const finalUserPrompt = this.fillTemplate(
      prompt.userPromptTemplate,
      dto.userInput ?? '',
    );
    const apiKey = this.config.get<string>('LIARA_API_KEY')!;

    try {
      if (prompt.outputType === CreativeOutputType.IMAGE) {
        const model = await this.resolveModel(
          prompt.preferredModel,
          CreativeOutputType.IMAGE,
        );
        if (!model)
          throw new BadRequestException(fa.discovery.generationFailed);

        const fullPrompt = `${systemPrompt}\n\n${finalUserPrompt}`.trim();
        const inputImageBuffers = dto.inputImageKeys?.length
          ? await Promise.all(
              dto.inputImageKeys.map((key) => this.storage.downloadImage(key)),
            )
          : [];

        const result = inputImageBuffers.length
          ? await this.imageGen.editImage({
              modelId: model.name,
              prompt: fullPrompt,
              images: inputImageBuffers,
              apiKey,
              size: model.imageGenSize ?? prompt.aspectRatio ?? undefined,
              quality: model.imageGenQuality ?? undefined,
            })
          : await this.imageGen.generateImage({
              modelId: model.name,
              prompt: fullPrompt,
              apiKey,
              size: model.imageGenSize ?? prompt.aspectRatio ?? undefined,
              quality: model.imageGenQuality ?? undefined,
            });

        return {
          outputType: CreativeOutputType.IMAGE,
          outputImageDataUrl: `data:image/png;base64,${result.base64}`,
        };
      }

      const model = await this.resolveModel(
        prompt.preferredModel,
        CreativeOutputType.TEXT,
      );
      const modelName =
        model?.name ??
        this.config.get<string>('SUMMARY_MODEL') ??
        'openai/gpt-4o-mini';
      const provider = createOpenAICompatible({
        name: 'liara',
        baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
        apiKey,
      });

      const { text } = await generateText({
        model: provider(modelName),
        system: systemPrompt || undefined,
        prompt: finalUserPrompt,
      });

      return { outputType: CreativeOutputType.TEXT, outputText: text };
    } catch (err) {
      this.logger.error(
        `anon discovery preview failed for prompt=${prompt.id}`,
        err as Error,
      );
      throw new BadRequestException(fa.discovery.generationFailed);
    }
  }

  private async buildSystemPrompt(
    promptContextMd: string,
    projectContextMd?: string,
  ): Promise<string> {
    const globalConfig = await this.chatConfig.getConfig();
    // ترتیب: ChatConfig.globalContextMd (سراسری) → Project.contextMd (اختیاری) → CreativePrompt.contextMd
    return [globalConfig.globalContextMd, projectContextMd, promptContextMd]
      .filter(Boolean)
      .join('\n\n');
  }

  private fillTemplate(template: string, userInput: string): string {
    return template.includes('{{input}}')
      ? template.replace(/\{\{input\}\}/g, userInput)
      : `${template}\n${userInput}`;
  }

  private async resolveModel(
    preferredModel: string | null,
    outputType: CreativeOutputType,
  ) {
    if (preferredModel) {
      const m = await this.prisma.aiModel.findUnique({
        where: { name: preferredModel },
      });
      if (m && m.isActive) return m;
    }
    return this.prisma.aiModel.findFirst({
      where: {
        isActive: true,
        modelType:
          outputType === CreativeOutputType.IMAGE
            ? AiModelType.IMAGE_GEN
            : AiModelType.CHAT,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

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

  private async generateImageOutput(
    userId: string,
    prompt: {
      id: string;
      creditCost: number;
      preferredModel: string | null;
      aspectRatio: string | null;
    },
    dto: GenerateCreativeDto,
    systemPrompt: string,
    finalUserPrompt: string,
    requiredToman: number,
  ) {
    const model = await this.resolveModel(
      prompt.preferredModel,
      CreativeOutputType.IMAGE,
    );
    if (!model) throw new BadRequestException(fa.discovery.generationFailed);

    const apiKey = await this.resolveApiKey(userId);
    const fullPrompt = `${systemPrompt}\n\n${finalUserPrompt}`.trim();

    const inputImageBuffers = dto.inputImageKeys?.length
      ? await Promise.all(
          dto.inputImageKeys.map((key) => this.storage.downloadImage(key)),
        )
      : [];

    const result = inputImageBuffers.length
      ? await this.imageGen.editImage({
          modelId: model.name,
          prompt: fullPrompt,
          images: inputImageBuffers,
          apiKey,
          size: model.imageGenSize ?? prompt.aspectRatio ?? undefined,
          quality: model.imageGenQuality ?? undefined,
        })
      : await this.imageGen.generateImage({
          modelId: model.name,
          prompt: fullPrompt,
          apiKey,
          size: model.imageGenSize ?? prompt.aspectRatio ?? undefined,
          quality: model.imageGenQuality ?? undefined,
        });

    const costCalc = await this.pricing.calcImageGenCost(result.usage, model);
    const outputBuffer = Buffer.from(result.base64, 'base64');
    const outputImageKey = await this.storage.uploadImage(outputBuffer, 'png');

    // کسر واقعی فقط الان — بعد از موفقیت تولید. markup=1 چون ۱.۳ قبلاً لحظه‌ی خرید بسته اعمال شده
    const debited = await this.pricing.debitWallet(
      userId,
      requiredToman,
      1,
      `تولید دیسکاوری — ${prompt.id}`,
      {
        promptId: prompt.id,
        projectId: dto.projectId ?? null,
        feature: 'discovery',
      },
    );
    if (!debited)
      this.logger.error(
        `discovery debitWallet: insufficient balance race for user=${userId} prompt=${prompt.id}`,
      );

    return this.prisma.creativeGeneration.create({
      data: {
        userId,
        promptId: prompt.id,
        projectId: dto.projectId ?? null,
        outputType: CreativeOutputType.IMAGE,
        inputImageKeys: dto.inputImageKeys ?? undefined,
        outputImageKey,
        userInput: dto.userInput || null,
        creditCost: prompt.creditCost,
        costToman: costCalc.costToman,
        model: model.name,
        status: CreativeGenerationStatus.SUCCEEDED,
      },
    });
  }

  private async generateTextOutput(
    userId: string,
    prompt: { id: string; creditCost: number; preferredModel: string | null },
    dto: GenerateCreativeDto,
    systemPrompt: string,
    finalUserPrompt: string,
    requiredToman: number,
  ) {
    const model = await this.resolveModel(
      prompt.preferredModel,
      CreativeOutputType.TEXT,
    );
    const modelName =
      model?.name ??
      this.config.get<string>('SUMMARY_MODEL') ??
      'openai/gpt-4o-mini';
    const apiKey = await this.resolveApiKey(userId);
    const provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey,
    });

    const { text, usage } = await generateText({
      model: provider(modelName),
      system: systemPrompt || undefined,
      prompt: finalUserPrompt,
    });

    const costCalc = model
      ? await this.pricing.calcCost(
          usage?.inputTokens ?? 0,
          usage?.outputTokens ?? 0,
          modelName,
        )
      : { costToman: 0 };

    const debited = await this.pricing.debitWallet(
      userId,
      requiredToman,
      1,
      `تولید دیسکاوری — ${prompt.id}`,
      {
        promptId: prompt.id,
        projectId: dto.projectId ?? null,
        feature: 'discovery',
      },
    );
    if (!debited)
      this.logger.error(
        `discovery debitWallet: insufficient balance race for user=${userId} prompt=${prompt.id}`,
      );

    return this.prisma.creativeGeneration.create({
      data: {
        userId,
        promptId: prompt.id,
        projectId: dto.projectId ?? null,
        outputType: CreativeOutputType.TEXT,
        outputText: text,
        userInput: dto.userInput || null,
        creditCost: prompt.creditCost,
        costToman: costCalc.costToman,
        model: modelName,
        status: CreativeGenerationStatus.SUCCEEDED,
      },
    });
  }

  // قیمت اکشن «تبدیل عکس به پرامپت» — قبل از آپلود/استخراج به کاربر نشان داده می‌شود
  async getExtractionCost() {
    const config = await this.credits.getConfig();
    return { creditCost: config.promptExtractionCreditCost };
  }

  // «تبدیل عکس به پرامپت» — کاربر عکسی آپلود می‌کند، یک مدل CHAT با supportsVision آن را
  // تحلیل و یک پرامپت تولید-عکس بازتولید می‌کند. نتیجه هم فوراً به کاربر نشان داده می‌شود
  // (متن پرامپت + یک CreativePrompt پنهان که خودش بلافاصله می‌تواند با آن تولید کند) و هم
  // به‌صورت پیشنهاد PENDING برای بررسی/تایید ادمین در مخزن پرامپت‌ها ثبت می‌شود.
  async extractPromptFromImage(userId: string, imageKey: string) {
    const creditConfig = await this.credits.getConfig();
    const walletBalance = await this.pricing.getWalletBalance(userId);
    const requiredToman =
      creditConfig.promptExtractionCreditCost * creditConfig.tomanPerCredit;
    if (walletBalance < requiredToman)
      throw new BadRequestException(fa.discovery.insufficientCredits);

    // محافظ ساده در برابر انباشت نامحدود پیشنهادهای بررسی‌نشده در جدول اصلی سبک‌ها
    const pendingCount = await this.prisma.creativePrompt.count({
      where: {
        submittedByUserId: userId,
        sourceType: CreativePromptSourceType.USER_EXTRACTED,
        reviewStatus: CreativePromptReviewStatus.PENDING,
      },
    });
    if (pendingCount >= 20)
      throw new BadRequestException(fa.discovery.tooManyPendingExtractions);

    const model = await this.prisma.aiModel.findFirst({
      where: { isActive: true, modelType: AiModelType.CHAT, supportsVision: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!model) throw new BadRequestException(fa.discovery.extractionFailed);

    const buffer = await this.storage.downloadImage(imageKey);
    const ext = imageKey.split('.').pop() ?? 'png';
    const dataUrl = `data:${mimeTypeForExt(ext)};base64,${buffer.toString('base64')}`;

    const apiKey = await this.resolveApiKey(userId);
    const provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey,
    });

    const visionMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: dataUrl },
        {
          type: 'text',
          text: 'این تصویر را با دقت تحلیل کن و یک پرامپت دقیق و کامل (فارسی) برای تولید دوباره‌ی تصویری با همین سبک/سوژه/ترکیب‌بندی/نورپردازی/رنگ‌بندی بنویس. فقط و فقط متن پرامپت را برگردان — بدون هیچ مقدمه، توضیح یا علامت‌گذاری اضافه.',
        },
      ],
    };

    let extractedPrompt: string;
    try {
      const { text } = await generateText({
        model: provider(model.name),
        messages: [visionMessage],
      });
      extractedPrompt = text.trim();
      if (!extractedPrompt) throw new Error('empty extraction result');
    } catch (err) {
      this.logger.error(
        `prompt extraction failed for user=${userId} image=${imageKey}`,
        err as Error,
      );
      throw new BadRequestException(fa.discovery.extractionFailed);
    }

    // کسر فقط بعد از موفقیت — دقیقاً هم‌قانون generate()
    const debited = await this.pricing.debitWallet(
      userId,
      requiredToman,
      1,
      'تبدیل عکس به پرامپت',
      { feature: 'prompt-extraction' },
    );
    if (!debited)
      this.logger.error(
        `prompt-extraction debitWallet: insufficient balance race for user=${userId}`,
      );

    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3000');
    const created = await this.prisma.creativePrompt.create({
      data: {
        title: 'سبک استخراج‌شده',
        outputType: CreativeOutputType.IMAGE,
        segment: CreativeSegment.GENERAL,
        contextMd: '',
        userPromptTemplate: extractedPrompt,
        exampleImageUrl: `${apiUrl}/api/v1/v2/discovery/example-images/${imageKey}`,
        requiresUserImage: false,
        creditCost: creditConfig.defaultExtractedPromptCreditCost,
        isActive: false,
        sourceType: CreativePromptSourceType.USER_EXTRACTED,
        submittedByUserId: userId,
        reviewStatus: CreativePromptReviewStatus.PENDING,
        sourceImageKey: imageKey,
      },
    });

    return {
      id: created.id,
      title: created.title,
      outputType: created.outputType,
      segment: created.segment,
      categoryId: created.categoryId,
      description: created.description,
      exampleImageUrl: created.exampleImageUrl,
      aspectRatio: created.aspectRatio,
      requiresUserImage: created.requiresUserImage,
      creditCost: created.creditCost,
      isTrending: created.isTrending,
      tags: created.tags,
      sortOrder: created.sortOrder,
      extractedPrompt,
    };
  }

  // تاریخچه‌ی «شخصی‌سازی‌های قبلی» یک پروژه — از dto.userInput واقعاً استفاده‌شده در
  // تولیدهای قبلی همان پروژه (نه یک جدول جدا؛ چیزی که کاربر واقعاً تولید کرده)
  async listProjectCustomizations(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project || project.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);

    const rows = await this.prisma.creativeGeneration.findMany({
      where: { projectId, userId, userInput: { not: null } },
      distinct: ['userInput'],
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { userInput: true, createdAt: true },
    });
    return rows.map((r) => ({ text: r.userInput as string, createdAt: r.createdAt }));
  }
}
