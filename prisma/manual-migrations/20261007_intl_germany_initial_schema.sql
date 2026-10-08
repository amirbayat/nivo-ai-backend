-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'TRIAL');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'WALLET_TOPUP', 'STORE_CREDIT_TOPUP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('ZARINPAL', 'VANDAR', 'ZIBAL', 'BAZAAR');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('FEATURE_REQUEST', 'BUG', 'UX', 'PRICING', 'GENERAL');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "PricingGenerationType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CreditPackageScope" AS ENUM ('GENERAL', 'NIVO_CAL', 'NIVO_CAL_BAZAAR', 'STORE_AI_CREDIT');

-- CreateEnum
CREATE TYPE "CreativeOutputType" AS ENUM ('IMAGE', 'TEXT');

-- CreateEnum
CREATE TYPE "CreativeSegment" AS ENUM ('GENERAL', 'INSTAGRAM', 'YOUTUBE', 'BUSINESS');

-- CreateEnum
CREATE TYPE "CreativePromptSourceType" AS ENUM ('CURATED', 'USER_EXTRACTED', 'AGENT_DISCOVERED');

-- CreateEnum
CREATE TYPE "CreativePromptReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreativeGenerationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('SIMPLE', 'MEDIUM', 'COMPLEX');

-- CreateEnum
CREATE TYPE "AiModelType" AS ENUM ('CHAT', 'EMBEDDING', 'IMAGE_GEN', 'VIDEO_GEN', 'AUDIO_TRANSCRIPTION');

-- CreateEnum
CREATE TYPE "AiPlatform" AS ENUM ('LIARA', 'OPENROUTER');

-- CreateEnum
CREATE TYPE "FeedbackVote" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "LeadFollowUpStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CaptionProjectStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'READY_FOR_EDIT', 'RENDERING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('WELCOME_GIFT', 'EXPIRY_REMINDER', 'REFERRAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "SalesKbKind" AS ENUM ('EXAMPLE', 'OBJECTION', 'FAQ', 'PERSONA_GUIDANCE');

-- CreateEnum
CREATE TYPE "LimitHitType" AS ENUM ('DAILY_MESSAGE_BLOCKED', 'BUDGET_EXCEEDED', 'SESSION_LIMIT', 'INPUT_TOO_LONG', 'ROLLING_WINDOW_BLOCKED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'GRANTED', 'ACTIVATED');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM ('PAYMENT_COMPLETED', 'WALLET_TOPUP_COMPLETED', 'TICKET_CREATED', 'SYSTEM_ERROR_SPIKE', 'LIARA_ERROR_RATE', 'QUEUE_JOB_FAILED');

-- CreateEnum
CREATE TYPE "PushCampaignSegment" AS ENUM ('ALL', 'REGISTERED_ONLY', 'ANONYMOUS_ONLY', 'ACTIVE_SUBSCRIBERS', 'BY_PLAN', 'PHONE_LIST');

-- CreateEnum
CREATE TYPE "AnonFunnelEventType" AS ENUM ('SESSION_CREATED', 'FIRST_MESSAGE_SENT', 'ENTERED_LIMITED_ZONE', 'HARD_BLOCKED', 'CLICKED_SIGNUP_CTA', 'SIGNUP_COMPLETED', 'FIRST_MESSAGE_AFTER_SIGNUP', 'FIRST_PURCHASE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "NutritionGoal" AS ENUM ('LOSE_WEIGHT', 'MAINTAIN', 'GAIN_WEIGHT');

-- CreateEnum
CREATE TYPE "VideoModelProvider" AS ENUM ('KIE', 'OPENROUTER', 'VEO', 'RUNWAY');

-- CreateEnum
CREATE TYPE "KieInputSchema" AS ENUM ('OMNI', 'SEEDANCE', 'WAN_V2V', 'WAN_R2V', 'WAN_VIDEO_EDIT');

-- CreateEnum
CREATE TYPE "KieVideoCategory" AS ENUM ('GENERATE', 'EDIT', 'UPSCALE', 'LIPSYNC', 'DUBBING', 'MOTION_TRANSFER', 'EXTEND', 'OTHER');

-- CreateEnum
CREATE TYPE "VideoEditMode" AS ENUM ('GENERATE', 'EDIT');

-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StoreBusinessType" AS ENUM ('PRODUCT_SALES', 'APPOINTMENT_BOOKING');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FIXED', 'WEIGHT_BASED_FORMULA');

-- CreateEnum
CREATE TYPE "GoldWageType" AS ENUM ('PERCENT', 'FIXED_PER_GRAM');

-- CreateEnum
CREATE TYPE "CardDisplayPolicy" AS ENUM ('THRESHOLD', 'PERCENTAGE', 'EQUAL');

-- CreateEnum
CREATE TYPE "ProductEnrichmentSource" AS ENUM ('ADMIN_RESOURCE', 'WEB_SEARCH');

-- CreateEnum
CREATE TYPE "ProductEnrichmentStatus" AS ENUM ('PENDING_ADMIN_REVIEW', 'PENDING_SELLER_REVIEW', 'SELLER_APPROVED', 'SELLER_REJECTED', 'ADMIN_REJECTED');

-- CreateEnum
CREATE TYPE "StoreKbKind" AS ENUM ('FAQ', 'POLICY', 'PRODUCT_INFO', 'GENERAL');

-- CreateEnum
CREATE TYPE "CustomerChannel" AS ENUM ('WEB', 'TELEGRAM', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('COMMENT_KEYWORD', 'STORY_REPLY', 'STORY_MENTION', 'DM_KEYWORD');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('GREETING', 'BROWSING', 'CART_REVIEW', 'ADDRESS_COLLECTION', 'AWAITING_PAYMENT', 'RECEIPT_SUBMITTED', 'AWAITING_SELLER_APPROVAL', 'COMPLETED', 'REJECTED', 'HANDOFF_HUMAN');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('FREE', 'PAID', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VoiceVariant" AS ENUM ('ON', 'OFF');

-- CreateEnum
CREATE TYPE "ResponseStrategy" AS ENUM ('RULE_BASED', 'SIMPLE_AGENT', 'FULL_AGENT');

-- CreateEnum
CREATE TYPE "CreditUsageKind" AS ENUM ('TEXT_REPLY', 'VOICE_TTS', 'ASR', 'TOPUP', 'PRODUCT_ENRICHMENT', 'AD_PLACEMENT', 'NOTES_ANALYSIS');

-- CreateEnum
CREATE TYPE "ContentChangeSource" AS ENUM ('MANUAL', 'AI_ENRICHMENT');

-- CreateEnum
CREATE TYPE "ContentEntityType" AS ENUM ('STORE', 'PRODUCT', 'KB_ENTRY', 'SHIPPING_RULE');

-- CreateEnum
CREATE TYPE "ConversationEventType" AS ENUM ('CUSTOMER_MESSAGE', 'SELLER_MESSAGE', 'AGENT_REPLY', 'TOOL_CALL', 'STATE_TRANSITION', 'SYSTEM', 'AI_TRACE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'RECEIPT_SUBMITTED', 'APPROVED', 'REJECTED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'AI_AUTO_REJECTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "AdPlacementType" AS ENUM ('TELEGRAM_STORE_SEARCH', 'MARKETPLACE_FEATURED', 'GREETING_FEATURED_PRODUCT');

-- CreateEnum
CREATE TYPE "AdPlacementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lifetimeMessageCount" INTEGER NOT NULL DEFAULT 0,
    "trialEndedAt" TIMESTAMP(3),
    "referralCode" TEXT NOT NULL,
    "referredByUserId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "dailyFreeTokens" INTEGER NOT NULL,
    "monthlyTotalTokens" INTEGER NOT NULL,
    "allowedModels" JSONB NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "featuredModels" JSONB NOT NULL DEFAULT '[]',
    "featuredModelsCount" INTEGER NOT NULL DEFAULT 5,
    "maxInputTokens" INTEGER NOT NULL DEFAULT 300,
    "outputThrottleSteps" JSONB NOT NULL DEFAULT '[]',
    "dailyMessageLimit" INTEGER,
    "throttledMessageCount" INTEGER,
    "throttledInputTokens" INTEGER,
    "throttledOutputTokens" INTEGER,
    "rollingWindowLimit" INTEGER,
    "rollingWindowHours" INTEGER NOT NULL DEFAULT 3,
    "simpleModel" TEXT DEFAULT 'openai/gpt-5-nano',
    "reasoningEffort" TEXT,
    "fastReasoningEffort" TEXT,
    "smartReasoningEffort" TEXT,
    "contextMd" TEXT,
    "trialMessageThreshold" INTEGER,
    "trialDailyMessageLimit" INTEGER,
    "trialThrottledMessageCount" INTEGER,
    "trialRollingWindowLimit" INTEGER,
    "trialRollingWindowHours" INTEGER,
    "isPayAsYouGo" BOOLEAN NOT NULL DEFAULT false,
    "payAsYouGoMarkup" DOUBLE PRECISION DEFAULT 1.3,
    "payAsYouGoMinActivationToman" INTEGER DEFAULT 1000000,
    "payAsYouGoMinTopupToman" INTEGER DEFAULT 500000,
    "payAsYouGoTopupPresets" JSONB DEFAULT '[1000000,2000000,5000000]',
    "defaultImageGenModel" TEXT,
    "maxImageGenPerDay" INTEGER,
    "maxImageGenPerWindow" INTEGER,
    "imageGenWindowHours" INTEGER DEFAULT 24,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_routing_steps" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "thresholdPct" INTEGER NOT NULL,
    "models" JSONB NOT NULL,
    "reasoningEffort" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_routing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contextSummary" TEXT,
    "summarizedAt" TIMESTAMP(3),
    "summarizedUntilCreatedAt" TIMESTAMP(3),
    "imageGenCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "images" JSONB,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "costInputUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "costOutputUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "openrouterRealCostUsdMicros" INTEGER,
    "openrouterRealCostToman" INTEGER,
    "model" TEXT,
    "topicId" TEXT,
    "citations" JSONB,
    "attachments" JSONB,
    "wasInterrupted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'SUBSCRIPTION',
    "storeId" TEXT,
    "planId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'ZARINPAL',
    "providerRef" TEXT,
    "refId" TEXT,
    "metadata" JSONB,
    "discountCodeId" TEXT,
    "packageId" TEXT,
    "credits" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "paymentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planName" TEXT,
    "amount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "provider" "PaymentProvider" NOT NULL,
    "refId" TEXT,
    "buyerName" TEXT,
    "buyerPhone" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "freeTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "paidTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "requestsCount" INTEGER NOT NULL DEFAULT 0,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liara_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "liaraKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liara_usage_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "realTokensTotal" INTEGER NOT NULL DEFAULT 0,
    "realCostToman" INTEGER NOT NULL DEFAULT 0,
    "realTextCostToman" INTEGER NOT NULL DEFAULT 0,
    "realImageCostToman" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liara_key_provisioning_issues" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastError" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_key_provisioning_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'GENERAL',
    "content" TEXT NOT NULL,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_summaries" (
    "id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topItems" JSONB NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "checkedUpTo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quota_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxInputTokens" INTEGER,
    "outputThrottleSteps" JSONB,
    "dailyBudgetToman" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_quota_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceToman" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tomanPerCredit" INTEGER NOT NULL DEFAULT 1200,
    "purchaseMarkup" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "roundingSteps" DOUBLE PRECISION[] DEFAULT ARRAY[0.2, 0.5, 0.8]::DOUBLE PRECISION[],
    "freeSignupCredits" INTEGER NOT NULL DEFAULT 20,
    "promptExtractionCreditCost" INTEGER NOT NULL DEFAULT 5,
    "defaultExtractedPromptCreditCost" INTEGER NOT NULL DEFAULT 16,
    "extractionEconomicalModel" TEXT DEFAULT 'openai/gpt-5.4-mini',
    "extractionEconomicalCreditCost" INTEGER NOT NULL DEFAULT 5,
    "extractionPremiumModel" TEXT,
    "extractionPremiumCreditCost" INTEGER NOT NULL DEFAULT 15,
    "sourceImageAccuracyCreditCost" INTEGER NOT NULL DEFAULT 4,
    "nivoCalScanCreditCost" INTEGER NOT NULL DEFAULT 1,
    "captionReRenderCreditCost" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_global_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "freeDailyQuota" INTEGER NOT NULL DEFAULT 10,
    "trialDurationDays" INTEGER NOT NULL DEFAULT 14,
    "trialCreditToman" INTEGER NOT NULL DEFAULT 300000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_agent_global_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_tiers" (
    "id" TEXT NOT NULL,
    "type" "PricingGenerationType" NOT NULL,
    "minToman" INTEGER NOT NULL,
    "maxToman" INTEGER,
    "markup" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caption_pricing_tiers" (
    "id" TEXT NOT NULL,
    "maxDurationSec" INTEGER,
    "creditCost" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caption_pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isBestValue" BOOLEAN NOT NULL DEFAULT false,
    "isCustomAmount" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scope" "CreditPackageScope" NOT NULL DEFAULT 'GENERAL',
    "bazaarSku" TEXT,
    "storeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_prompts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outputType" "CreativeOutputType" NOT NULL,
    "segment" "CreativeSegment" NOT NULL,
    "categoryId" TEXT,
    "description" TEXT,
    "contextMd" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "exampleImageUrl" TEXT,
    "aspectRatio" TEXT,
    "requiresUserImage" BOOLEAN NOT NULL DEFAULT false,
    "creditCost" INTEGER NOT NULL,
    "preferredModel" TEXT,
    "isFreeformPrompt" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceType" "CreativePromptSourceType" NOT NULL DEFAULT 'CURATED',
    "submittedByUserId" TEXT,
    "reviewStatus" "CreativePromptReviewStatus",
    "sourceImageKey" TEXT,
    "agentSourceUrl" TEXT,

    CONSTRAINT "creative_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_generations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "projectId" TEXT,
    "conversationId" TEXT,
    "outputType" "CreativeOutputType" NOT NULL,
    "inputImageKeys" JSONB,
    "outputImageKey" TEXT,
    "outputText" TEXT,
    "userInput" TEXT,
    "creditCost" INTEGER NOT NULL,
    "costToman" INTEGER NOT NULL,
    "model" TEXT,
    "status" "CreativeGenerationStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "CreativeSegment" NOT NULL,
    "niche" TEXT,
    "contextMd" TEXT NOT NULL,
    "brandColor" TEXT,
    "logoImageKey" TEXT,
    "pinnedPromptId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contextSummary" TEXT,
    "contextSummarizedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_prompt_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform" "CreativeSegment",
    "referenceUrl" TEXT,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_prompt_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_replies" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromAdmin" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelType" "AiModelType" NOT NULL DEFAULT 'CHAT',
    "inputPricePerM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outputPricePerM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsImageGen" BOOLEAN NOT NULL DEFAULT false,
    "imageGenInputImagePricePerM" DOUBLE PRECISION,
    "imageGenOutputImagePricePerM" DOUBLE PRECISION,
    "imageGenQuality" TEXT,
    "imageGenSize" TEXT,
    "imageGenFlatPriceUsd" DOUBLE PRECISION,
    "imageGenFlatPriceUnit" TEXT,
    "imageGenUseDirectApi" BOOLEAN NOT NULL DEFAULT false,
    "imageGenRequiresInputImage" BOOLEAN NOT NULL DEFAULT false,
    "estimatedImageGenCostUsd" DOUBLE PRECISION,
    "estimatedImageGenCreditCost" DOUBLE PRECISION,
    "videoGenPricePerSecondUsd" DOUBLE PRECISION,
    "videoGenAudioMultiplier" DOUBLE PRECISION,
    "videoGenSupportedDurationsSec" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "videoGenSupportedSizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoStudioEligible" BOOLEAN NOT NULL DEFAULT false,
    "asrPricePerMinuteUsd" DOUBLE PRECISION,
    "asrSupportsWordTimestamps" BOOLEAN NOT NULL DEFAULT false,
    "supportsWebSearch" BOOLEAN NOT NULL DEFAULT false,
    "supportsFileInput" BOOLEAN NOT NULL DEFAULT false,
    "supportsVideoInput" BOOLEAN NOT NULL DEFAULT false,
    "supportsAudioInput" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tier" "ModelTier" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platform" "AiPlatform"[] DEFAULT ARRAY['LIARA']::"AiPlatform"[],
    "tokenizerFamily" TEXT NOT NULL DEFAULT 'approximate',
    "avgCharsPerToken" DOUBLE PRECISION NOT NULL DEFAULT 4,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routing_configs" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "simpleKeywords" JSONB NOT NULL DEFAULT '[]',
    "complexKeywords" JSONB NOT NULL DEFAULT '[]',
    "complexLenThreshold" INTEGER NOT NULL DEFAULT 600,
    "llmFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "llmFallbackModel" TEXT NOT NULL DEFAULT 'openai/gpt-4o-mini',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_routing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routing_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "chosenModel" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL,
    "method" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "overrodeManual" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_routing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_feedbacks" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" "FeedbackVote" NOT NULL,
    "comment" TEXT,
    "modelUsed" TEXT NOT NULL,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_feedback_summaries" (
    "id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topIssues" JSONB NOT NULL,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "checkedUpTo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_feedback_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_profiles" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "age" INTEGER,
    "city" TEXT,
    "jobTitle" TEXT,
    "interests" JSONB,
    "chatHistory" JSONB,
    "recommendedPlan" TEXT,
    "source" TEXT NOT NULL DEFAULT 'pricing_page',
    "discountOffered" BOOLEAN NOT NULL DEFAULT false,
    "followUpStatus" "LeadFollowUpStatus" NOT NULL DEFAULT 'NEW',
    "guideContentMd" TEXT,
    "guideSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeId" TEXT,

    CONSTRAINT "lead_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_bot_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "contextMd" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'openai/gpt-5.4-mini',
    "embeddingModel" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 800,
    "maxMessages" INTEGER NOT NULL DEFAULT 15,
    "discountEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discountMinMessages" INTEGER NOT NULL DEFAULT 6,
    "discountPromptText" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_bot_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "globalContextMd" TEXT NOT NULL DEFAULT '',
    "summaryTriggerTokens" INTEGER NOT NULL DEFAULT 5000,
    "summaryMaxTokens" INTEGER NOT NULL DEFAULT 200,
    "projectContextMaxChars" INTEGER NOT NULL DEFAULT 3000,
    "maxImagesPerMessage" INTEGER NOT NULL DEFAULT 4,
    "maxImageSizeMb" INTEGER NOT NULL DEFAULT 8,
    "allowedImageFormats" JSONB NOT NULL DEFAULT '["png","jpeg","webp","gif"]',
    "implicitImageGenEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webSearchCreditCostToman" INTEGER NOT NULL DEFAULT 0,
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "maxExtractedChars" INTEGER NOT NULL DEFAULT 80000,
    "maxVideoSizeMb" INTEGER NOT NULL DEFAULT 12,
    "maxAudioSizeMb" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caption_projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceVideoKey" TEXT NOT NULL,
    "sourceDurationSec" DOUBLE PRECISION,
    "sourceWidth" INTEGER,
    "sourceHeight" INTEGER,
    "debugAudioKey" TEXT,
    "sourceDeletedAt" TIMESTAMP(3),
    "asrModelName" TEXT,
    "transcriptWords" JSONB,
    "segments" JSONB,
    "styleId" TEXT,
    "styleOverrides" JSONB,
    "status" "CaptionProjectStatus" NOT NULL DEFAULT 'UPLOADED',
    "renderProgress" INTEGER NOT NULL DEFAULT 0,
    "renderedVideoKey" TEXT,
    "asrCostUsd" DOUBLE PRECISION,
    "renderCreditCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caption_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "welcomeDiscountPercent" INTEGER NOT NULL DEFAULT 20,
    "welcomeDiscountValidHours" INTEGER NOT NULL DEFAULT 72,
    "expiryDiscountPercent" INTEGER NOT NULL DEFAULT 15,
    "referralDiscountPercent" INTEGER NOT NULL DEFAULT 20,
    "referralDiscountValidDays" INTEGER NOT NULL DEFAULT 30,
    "postTrialGraceHours" INTEGER NOT NULL DEFAULT 24,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_gift" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "title" TEXT NOT NULL DEFAULT 'هدیه ویژه نیوو به کاربران تازه',
    "description" TEXT NOT NULL DEFAULT '',
    "audioUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "source" "DiscountSource" NOT NULL,
    "issuedToUserId" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_code_redemptions" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_bot_daily_usage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "sessionsStarted" INTEGER NOT NULL DEFAULT 0,
    "discountOffersShown" INTEGER NOT NULL DEFAULT 0,
    "phonesCaptured" INTEGER NOT NULL DEFAULT 0,
    "embeddingCalls" INTEGER NOT NULL DEFAULT 0,
    "embeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingCostToman" INTEGER NOT NULL DEFAULT 0,
    "embeddingCostUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "ctaFreeStartClicks" INTEGER NOT NULL DEFAULT 0,
    "ctaPricingClicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_bot_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_chat_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_kb_entries" (
    "id" TEXT NOT NULL,
    "kind" "SalesKbKind" NOT NULL,
    "label" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "userMessage" TEXT NOT NULL,
    "assistantReply" TEXT NOT NULL,
    "note" TEXT,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_kb_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" JSONB NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_segments" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minMessagesPerDay" INTEGER,
    "maxMessagesPerDay" INTEGER,
    "minTokensPerDay" INTEGER,
    "maxTokensPerDay" INTEGER,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limit_hit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LimitHitType" NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "limit_hit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL,
    "grantedCount" INTEGER NOT NULL DEFAULT 0,
    "maxWaitlistSize" INTEGER,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "waitlistMessage" TEXT NOT NULL,
    "waitlistFullMessage" TEXT,
    "waitlistDailyMessageLimit" INTEGER NOT NULL DEFAULT 4,
    "displayCounterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "displayInitialPctMin" INTEGER NOT NULL DEFAULT 15,
    "displayInitialPctMax" INTEGER NOT NULL DEFAULT 25,
    "displayFloorMin" INTEGER NOT NULL DEFAULT 3,
    "displayFloorMax" INTEGER NOT NULL DEFAULT 8,
    "displayAnimationTickMs" INTEGER NOT NULL DEFAULT 500,
    "displayDecrementMin" INTEGER NOT NULL DEFAULT 1,
    "displayDecrementMax" INTEGER NOT NULL DEFAULT 3,
    "grantedSmsTemplate" TEXT,
    "reminderSteps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" TEXT,

    CONSTRAINT "launch_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_outages" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "extendedDays" DOUBLE PRECISION,
    "affectedCount" INTEGER,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_outages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "activationToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastReminderStepSent" INTEGER,
    "lastReminderSentAt" TIMESTAMP(3),

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT,
    "coverImageUrl" TEXT,
    "contentMd" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "isPinnedInBanner" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isAgentGenerated" BOOLEAN NOT NULL DEFAULT false,
    "agentSourceUrls" JSONB,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_agent_api_keys" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "readBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_device_tokens" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "deviceUuid" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_campaigns" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "segment" "PushCampaignSegment" NOT NULL,
    "phoneList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_chat_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultModel" TEXT NOT NULL DEFAULT 'openai/gpt-4o-mini',
    "freeMessageLimit" INTEGER NOT NULL DEFAULT 10,
    "dailyMessageLimitAfterFree" INTEGER NOT NULL DEFAULT 5,
    "maxInputTokens" INTEGER NOT NULL DEFAULT 2000,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 1000,
    "reasoningEffort" TEXT,
    "signupBannerMessage" TEXT NOT NULL DEFAULT '🎁 با ثبت‌نام رایگان، اعتبار و امکانات بیشتری بگیرید',
    "limitedZoneMessage" TEXT NOT NULL DEFAULT 'برای استفاده‌ی کامل و بدون محدودیت از نیوو، ثبت‌نام کنید',
    "blockedMessage" TEXT NOT NULL DEFAULT 'برای ادامه، لازم است ثبت‌نام کنید یا فردا دوباره امتحان کنید.',
    "hintTitle" TEXT NOT NULL DEFAULT 'چطور می‌تونم امروز کمکتون کنم؟',
    "hintSubtitle" TEXT NOT NULL DEFAULT 'هر سوالی داری بپرس — نوشتن، برنامه‌نویسی، ترجمه، تحلیل و خیلی چیزای دیگه',
    "signupBannerAfterMessages" INTEGER NOT NULL DEFAULT 3,
    "samplePrompts" TEXT[] DEFAULT ARRAY['این ایمیل رو رسمی‌تر و مودبانه‌تر بنویس', 'خلاصه‌ی این متن رو در ۳ خط بگو', 'یک برنامه‌ی غذایی هفتگی سالم پیشنهاد بده', 'این کد رو دیباگ کن و توضیح بده مشکلش چیه', 'برام یک کپشن جذاب برای اینستاگرام بنویس']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anonymous_chat_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_identities" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "lifetimeMessageCount" INTEGER NOT NULL DEFAULT 0,
    "discoveryTrialUsedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anonymous_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_sessions" (
    "id" TEXT NOT NULL,
    "clientToken" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "migratedToUserId" TEXT,
    "migratedAt" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "referrer" TEXT,
    "landingPath" TEXT,

    CONSTRAINT "anonymous_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_conversations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "title" TEXT,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "migratedConversationId" TEXT,

    CONSTRAINT "anonymous_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anonymous_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_funnel_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "AnonFunnelEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "anonymous_funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageStorageKey" TEXT NOT NULL,
    "note" TEXT,
    "resultJson" JSONB NOT NULL,
    "totalCalories" INTEGER NOT NULL,
    "healthScore" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "age" INTEGER NOT NULL,
    "heightCm" INTEGER NOT NULL,
    "activityLevel" "ActivityLevel" NOT NULL,
    "goal" "NutritionGoal" NOT NULL,
    "goalPaceLevel" INTEGER NOT NULL,
    "dailyCalorieTarget" INTEGER NOT NULL,
    "proteinTargetG" INTEGER NOT NULL,
    "carbsTargetG" INTEGER NOT NULL,
    "fatTargetG" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kie_video_models" (
    "id" TEXT NOT NULL,
    "provider" "VideoModelProvider" NOT NULL DEFAULT 'KIE',
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "KieVideoCategory" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "supportsImages" BOOLEAN NOT NULL DEFAULT false,
    "maxImages" INTEGER,
    "supportsVideo" BOOLEAN NOT NULL DEFAULT false,
    "maxVideoDurationSec" INTEGER,
    "maxVideoWindowSec" INTEGER,
    "supportsAspectRatio" BOOLEAN NOT NULL DEFAULT true,
    "supportsDuration" BOOLEAN NOT NULL DEFAULT true,
    "resolutions" TEXT[] DEFAULT ARRAY['720p']::TEXT[],
    "kieInputSchema" "KieInputSchema" NOT NULL DEFAULT 'OMNI',
    "supportsScenePreservingEdit" BOOLEAN NOT NULL DEFAULT false,
    "fixedDurations" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "pricePerSecondUsdConfirmed" DOUBLE PRECISION,
    "pricingNote" TEXT,
    "inputFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kie_video_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_edit_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "generateFixedDurationSec" INTEGER NOT NULL DEFAULT 8,
    "maxConcurrentJobsPerUser" INTEGER NOT NULL DEFAULT 1,
    "maxJobsPerDayPerUser" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_edit_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_edit_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_edit_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_edit_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kieVideoModelId" TEXT NOT NULL,
    "mode" "VideoEditMode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "referenceImageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoKey" TEXT,
    "videoWindowStartSec" DOUBLE PRECISION,
    "videoWindowEndSec" DOUBLE PRECISION,
    "aspectRatio" TEXT DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "valuesJson" JSONB,
    "status" "VideoJobStatus" NOT NULL DEFAULT 'PENDING',
    "kieTaskId" TEXT,
    "kieState" TEXT,
    "progressPercent" INTEGER,
    "resultVideoKey" TEXT,
    "errorMessage" TEXT,
    "creditsConsumedRaw" DOUBLE PRECISION,
    "creditCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "video_edit_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "businessType" "StoreBusinessType" NOT NULL DEFAULT 'PRODUCT_SALES',
    "bankCardNumber" TEXT,
    "bankOwnerName" TEXT,
    "instagramUrl" TEXT,
    "telegramUrl" TEXT,
    "websiteUrl" TEXT,
    "ownerTelegramChatId" TEXT,
    "telegramConnectToken" TEXT,
    "telegramConnectTokenExpiresAt" TIMESTAMP(3),
    "instagramBusinessId" TEXT,
    "instagramAccessToken" TEXT,
    "instagramTokenExpiresAt" TIMESTAMP(3),
    "instagramConnectedAt" TIMESTAMP(3),
    "sellerBotChatId" TEXT,
    "sellerBotLinkedAt" TIMESTAMP(3),
    "lastEnrichmentNudgeAt" TIMESTAMP(3),
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditBalanceToman" INTEGER NOT NULL DEFAULT 0,
    "freeVoiceConversationsUsed" INTEGER NOT NULL DEFAULT 0,
    "freeVoiceQuotaResetAt" TIMESTAMP(3),
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "trialCreditRemainingToman" INTEGER NOT NULL DEFAULT 0,
    "cardDisplayPolicy" "CardDisplayPolicy" NOT NULL DEFAULT 'EQUAL',
    "lastCardIndex" INTEGER NOT NULL DEFAULT 0,
    "shippingInfo" TEXT,
    "returnPolicy" TEXT,
    "brandIntro" TEXT,
    "ownerNotes" TEXT,
    "workingHoursStart" TEXT,
    "workingHoursEnd" TEXT,
    "postPurchaseFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "abandonedCartReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "persuasionTechniquesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logoImageKey" TEXT,
    "requiresShipping" BOOLEAN NOT NULL DEFAULT true,
    "leadCaptureOnly" BOOLEAN NOT NULL DEFAULT false,
    "goldWageType" "GoldWageType",
    "goldWageValue" DOUBLE PRECISION,
    "goldProfitPercent" DOUBLE PRECISION,
    "goldVatPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "isDemoTemplate" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "clonedFromStoreId" TEXT,
    "attentionSuggestions" JSONB,
    "attentionSuggestionsComputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_bank_cards" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "thresholdToman" INTEGER,
    "percentWeight" INTEGER,
    "totalConfirmedToman" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_bank_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videos" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "specs" JSONB,
    "ownerNotes" TEXT,
    "code" TEXT,
    "persuasionTechniquesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'FIXED',
    "weightGrams" DOUBLE PRECISION,
    "purityKarat" INTEGER,
    "goldWageType" "GoldWageType",
    "goldWageValue" DOUBLE PRECISION,
    "goldProfitPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "telegramShortCode" TEXT,
    "canonicalProductId" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_types" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" TEXT NOT NULL,
    "optionTypeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionValues" JSONB NOT NULL,
    "priceOverride" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "weightGrams" DOUBLE PRECISION,
    "purityKarat" INTEGER,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_products" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "richDescription" TEXT NOT NULL,
    "specs" JSONB,
    "sourceCount" INTEGER NOT NULL DEFAULT 1,
    "lastEnrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_enrichment_drafts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductEnrichmentStatus" NOT NULL DEFAULT 'PENDING_ADMIN_REVIEW',
    "source" "ProductEnrichmentSource" NOT NULL,
    "adminResourceText" TEXT,
    "suggestedDescription" TEXT NOT NULL,
    "suggestedQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedSpecs" JSONB,
    "sourceNote" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminReviewedAt" TIMESTAMP(3),
    "sellerDecidedAt" TIMESTAMP(3),

    CONSTRAINT "product_enrichment_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_kb_entries" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "StoreKbKind" NOT NULL DEFAULT 'FAQ',
    "relatedProductId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "sourceFileKey" TEXT,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_kb_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_automation_rules" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "targetMediaId" TEXT,
    "keyword" TEXT,
    "staticReplyText" TEXT,
    "staticDmText" TEXT NOT NULL,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" "CustomerChannel" NOT NULL DEFAULT 'WEB',
    "sessionToken" TEXT,
    "telegramChatId" TEXT,
    "instagramPsid" TEXT,
    "phone" TEXT,
    "fullName" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerNeedCounts" JSONB,
    "userId" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_products" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postalCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_shipping_rules" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cost" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_shipping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_conversations" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currentState" "ConversationState" NOT NULL DEFAULT 'GREETING',
    "contextData" JSONB NOT NULL DEFAULT '{}',
    "isMutedForHuman" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "clarifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "abVariant" TEXT,
    "voiceGenerationCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveVoiceReplyCount" INTEGER NOT NULL DEFAULT 0,
    "voiceVariant" "VoiceVariant" NOT NULL DEFAULT 'ON',
    "responseStrategy" "ResponseStrategy" NOT NULL DEFAULT 'RULE_BASED',
    "openQuestionStreak" INTEGER NOT NULL DEFAULT 0,
    "billingMode" "BillingMode" NOT NULL DEFAULT 'FREE',
    "abandonedCartReminderSentAt" TIMESTAMP(3),
    "secondAbandonedCartReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_usage_events" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "kind" "CreditUsageKind" NOT NULL,
    "costToman" INTEGER NOT NULL,
    "isFreeQuota" BOOLEAN NOT NULL DEFAULT false,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_change_logs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "entityType" "ContentEntityType" NOT NULL,
    "entityId" TEXT,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "ContentChangeSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_model_metrics" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_model_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_events" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "ConversationEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "receiptImageKey" TEXT,
    "rejectReason" TEXT,
    "bankCardId" TEXT,
    "discountCodeId" TEXT,
    "satisfactionFollowUpSentAt" TIMESTAMP(3),
    "mediaReviewFollowUpSentAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "shippingProvince" TEXT,
    "shippingAddress" TEXT,
    "postalCode" TEXT,
    "addressId" TEXT,
    "shippingCostToman" INTEGER,
    "receiptExtractedAmountToman" INTEGER,
    "receiptVerifiedMatch" BOOLEAN,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_comments" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT,
    "customerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rating" INTEGER,
    "imageKey" TEXT,
    "videoKey" TEXT,
    "audioKey" TEXT,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "aiVerdict" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_discount_codes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,

    CONSTRAINT "store_discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_placements" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "placement" "AdPlacementType" NOT NULL DEFAULT 'TELEGRAM_STORE_SEARCH',
    "productId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "status" "AdPlacementStatus" NOT NULL DEFAULT 'ACTIVE',
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "plan_routing_steps_planId_idx" ON "plan_routing_steps"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_routing_steps_planId_order_key" ON "plan_routing_steps"("planId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "conversations_userId_lastMessageAt_idx" ON "conversations"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "conversations_projectId_lastMessageAt_idx" ON "conversations"("projectId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_userId_createdAt_idx" ON "messages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_topicId_createdAt_idx" ON "messages"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerRef_key" ON "payments"("providerRef");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "payments_storeId_idx" ON "payments"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentId_key" ON "invoices"("paymentId");

-- CreateIndex
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "daily_usage_date_idx" ON "daily_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_usage_userId_date_key" ON "daily_usage"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "liara_api_keys_userId_key" ON "liara_api_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "liara_api_keys_keyName_key" ON "liara_api_keys"("keyName");

-- CreateIndex
CREATE INDEX "liara_usage_snapshots_date_idx" ON "liara_usage_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "liara_usage_snapshots_userId_date_key" ON "liara_usage_snapshots"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "liara_key_provisioning_issues_userId_key" ON "liara_key_provisioning_issues"("userId");

-- CreateIndex
CREATE INDEX "feedbacks_isChecked_createdAt_idx" ON "feedbacks"("isChecked", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_quota_overrides_userId_key" ON "user_quota_overrides"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "pricing_tiers_type_minToman_idx" ON "pricing_tiers"("type", "minToman");

-- CreateIndex
CREATE UNIQUE INDEX "credit_packages_bazaarSku_key" ON "credit_packages"("bazaarSku");

-- CreateIndex
CREATE INDEX "credit_packages_storeId_idx" ON "credit_packages"("storeId");

-- CreateIndex
CREATE INDEX "creative_categories_parentId_sortOrder_idx" ON "creative_categories"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "creative_prompts_outputType_segment_isActive_idx" ON "creative_prompts"("outputType", "segment", "isActive");

-- CreateIndex
CREATE INDEX "creative_prompts_categoryId_idx" ON "creative_prompts"("categoryId");

-- CreateIndex
CREATE INDEX "creative_prompts_sourceType_reviewStatus_idx" ON "creative_prompts"("sourceType", "reviewStatus");

-- CreateIndex
CREATE INDEX "creative_generations_userId_createdAt_idx" ON "creative_generations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "creative_generations_projectId_createdAt_idx" ON "creative_generations"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "creative_generations_conversationId_createdAt_idx" ON "creative_generations"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "projects_userId_idx" ON "projects"("userId");

-- CreateIndex
CREATE INDEX "creative_prompt_requests_isReviewed_createdAt_idx" ON "creative_prompt_requests"("isReviewed", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_name_key" ON "ai_models"("name");

-- CreateIndex
CREATE INDEX "model_routing_logs_userId_createdAt_idx" ON "model_routing_logs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedbacks_messageId_key" ON "message_feedbacks"("messageId");

-- CreateIndex
CREATE INDEX "message_feedbacks_isChecked_createdAt_idx" ON "message_feedbacks"("isChecked", "createdAt");

-- CreateIndex
CREATE INDEX "message_feedbacks_modelUsed_vote_idx" ON "message_feedbacks"("modelUsed", "vote");

-- CreateIndex
CREATE UNIQUE INDEX "lead_profiles_sessionId_key" ON "lead_profiles"("sessionId");

-- CreateIndex
CREATE INDEX "lead_profiles_storeId_idx" ON "lead_profiles"("storeId");

-- CreateIndex
CREATE INDEX "caption_projects_userId_idx" ON "caption_projects"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_issuedToUserId_idx" ON "discount_codes"("issuedToUserId");

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_redemptions_paymentId_key" ON "discount_code_redemptions"("paymentId");

-- CreateIndex
CREATE INDEX "sales_bot_daily_usage_date_idx" ON "sales_bot_daily_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_bot_daily_usage_date_key" ON "sales_bot_daily_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_chat_sessions_sessionId_key" ON "sales_chat_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "sales_chat_sessions_lastMessageAt_idx" ON "sales_chat_sessions"("lastMessageAt");

-- CreateIndex
CREATE INDEX "sales_kb_entries_kind_idx" ON "sales_kb_entries"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

-- CreateIndex
CREATE INDEX "limit_hit_events_date_type_idx" ON "limit_hit_events"("date", "type");

-- CreateIndex
CREATE INDEX "limit_hit_events_userId_date_idx" ON "limit_hit_events"("userId", "date");

-- CreateIndex
CREATE INDEX "launch_campaigns_status_idx" ON "launch_campaigns"("status");

-- CreateIndex
CREATE INDEX "network_outages_endedAt_idx" ON "network_outages"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_userId_key" ON "waitlist_entries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_activationToken_key" ON "waitlist_entries"("activationToken");

-- CreateIndex
CREATE INDEX "waitlist_entries_campaignId_status_createdAt_idx" ON "waitlist_entries"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "article_categories_name_key" ON "article_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "article_categories_slug_key" ON "article_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE INDEX "articles_status_publishedAt_idx" ON "articles"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "content_agent_api_keys_keyHash_key" ON "content_agent_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "admin_notifications_createdAt_idx" ON "admin_notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_device_tokens_token_key" ON "admin_device_tokens"("token");

-- CreateIndex
CREATE INDEX "admin_device_tokens_adminId_idx" ON "admin_device_tokens"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_deviceUuid_key" ON "device_tokens"("deviceUuid");

-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE INDEX "push_campaigns_createdAt_idx" ON "push_campaigns"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_identities_ip_key" ON "anonymous_identities"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_sessions_clientToken_key" ON "anonymous_sessions"("clientToken");

-- CreateIndex
CREATE INDEX "anonymous_sessions_identityId_idx" ON "anonymous_sessions"("identityId");

-- CreateIndex
CREATE INDEX "anonymous_sessions_migratedToUserId_idx" ON "anonymous_sessions"("migratedToUserId");

-- CreateIndex
CREATE INDEX "anonymous_conversations_sessionId_lastMessageAt_idx" ON "anonymous_conversations"("sessionId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "anonymous_messages_conversationId_createdAt_idx" ON "anonymous_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "anonymous_funnel_events_eventType_createdAt_idx" ON "anonymous_funnel_events"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_funnel_events_sessionId_eventType_key" ON "anonymous_funnel_events"("sessionId", "eventType");

-- CreateIndex
CREATE INDEX "food_logs_userId_createdAt_idx" ON "food_logs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_profiles_userId_key" ON "nutrition_profiles"("userId");

-- CreateIndex
CREATE INDEX "weight_logs_userId_createdAt_idx" ON "weight_logs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kie_video_models_slug_key" ON "kie_video_models"("slug");

-- CreateIndex
CREATE INDEX "video_edit_sessions_userId_idx" ON "video_edit_sessions"("userId");

-- CreateIndex
CREATE INDEX "video_edit_jobs_userId_idx" ON "video_edit_jobs"("userId");

-- CreateIndex
CREATE INDEX "video_edit_jobs_sessionId_idx" ON "video_edit_jobs"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_telegramConnectToken_key" ON "stores"("telegramConnectToken");

-- CreateIndex
CREATE UNIQUE INDEX "stores_instagramBusinessId_key" ON "stores"("instagramBusinessId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_sellerBotChatId_key" ON "stores"("sellerBotChatId");

-- CreateIndex
CREATE INDEX "stores_sellerId_idx" ON "stores"("sellerId");

-- CreateIndex
CREATE INDEX "stores_isDemoTemplate_category_idx" ON "stores"("isDemoTemplate", "category");

-- CreateIndex
CREATE INDEX "stores_sellerId_isDemo_idx" ON "stores"("sellerId", "isDemo");

-- CreateIndex
CREATE INDEX "store_bank_cards_storeId_isActive_idx" ON "store_bank_cards"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "products_telegramShortCode_key" ON "products"("telegramShortCode");

-- CreateIndex
CREATE INDEX "products_storeId_idx" ON "products"("storeId");

-- CreateIndex
CREATE INDEX "products_canonicalProductId_idx" ON "products"("canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_code_key" ON "products"("storeId", "code");

-- CreateIndex
CREATE INDEX "product_option_types_productId_idx" ON "product_option_types"("productId");

-- CreateIndex
CREATE INDEX "product_option_values_optionTypeId_idx" ON "product_option_values"("optionTypeId");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_optionValues_key" ON "product_variants"("productId", "optionValues");

-- CreateIndex
CREATE INDEX "canonical_products_normalizedName_idx" ON "canonical_products"("normalizedName");

-- CreateIndex
CREATE INDEX "product_enrichment_drafts_productId_idx" ON "product_enrichment_drafts"("productId");

-- CreateIndex
CREATE INDEX "product_enrichment_drafts_status_idx" ON "product_enrichment_drafts"("status");

-- CreateIndex
CREATE INDEX "store_kb_entries_storeId_isActive_idx" ON "store_kb_entries"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "instagram_automation_rules_storeId_isActive_idx" ON "instagram_automation_rules"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "customers_storeId_idx" ON "customers"("storeId");

-- CreateIndex
CREATE INDEX "customers_userId_idx" ON "customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_sessionToken_key" ON "customers"("storeId", "sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_telegramChatId_key" ON "customers"("storeId", "telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_instagramPsid_key" ON "customers"("storeId", "instagramPsid");

-- CreateIndex
CREATE INDEX "saved_products_customerId_idx" ON "saved_products"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_products_customerId_productId_key" ON "saved_products"("customerId", "productId");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "store_shipping_rules_storeId_idx" ON "store_shipping_rules"("storeId");

-- CreateIndex
CREATE INDEX "sales_conversations_storeId_idx" ON "sales_conversations"("storeId");

-- CreateIndex
CREATE INDEX "sales_conversations_storeId_isMutedForHuman_idx" ON "sales_conversations"("storeId", "isMutedForHuman");

-- CreateIndex
CREATE INDEX "sales_conversations_customerId_createdAt_idx" ON "sales_conversations"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_conversations_currentState_abandonedCartReminderSentA_idx" ON "sales_conversations"("currentState", "abandonedCartReminderSentAt");

-- CreateIndex
CREATE INDEX "sales_conversations_currentState_secondAbandonedCartReminde_idx" ON "sales_conversations"("currentState", "secondAbandonedCartReminderSentAt");

-- CreateIndex
CREATE INDEX "credit_usage_events_storeId_createdAt_idx" ON "credit_usage_events"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_usage_events_customerId_idx" ON "credit_usage_events"("customerId");

-- CreateIndex
CREATE INDEX "content_change_logs_storeId_entityType_entityId_createdAt_idx" ON "content_change_logs"("storeId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ab_model_metrics_variant_idx" ON "ab_model_metrics"("variant");

-- CreateIndex
CREATE INDEX "ab_model_metrics_conversationId_idx" ON "ab_model_metrics"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_events_conversationId_idx" ON "conversation_events"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_conversationId_key" ON "orders"("conversationId");

-- CreateIndex
CREATE INDEX "orders_storeId_idx" ON "orders"("storeId");

-- CreateIndex
CREATE INDEX "orders_status_satisfactionFollowUpSentAt_idx" ON "orders"("status", "satisfactionFollowUpSentAt");

-- CreateIndex
CREATE INDEX "orders_status_mediaReviewFollowUpSentAt_idx" ON "orders"("status", "mediaReviewFollowUpSentAt");

-- CreateIndex
CREATE INDEX "orders_storeId_createdAt_idx" ON "orders"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_recipientPhone_idx" ON "orders"("recipientPhone");

-- CreateIndex
CREATE INDEX "product_comments_storeId_status_idx" ON "product_comments"("storeId", "status");

-- CreateIndex
CREATE INDEX "product_comments_productId_idx" ON "product_comments"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "store_discount_codes_storeId_code_key" ON "store_discount_codes"("storeId", "code");

-- CreateIndex
CREATE INDEX "ad_placements_placement_status_startsAt_endsAt_idx" ON "ad_placements"("placement", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ad_placements_productId_idx" ON "ad_placements"("productId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_routing_steps" ADD CONSTRAINT "plan_routing_steps_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "credit_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liara_api_keys" ADD CONSTRAINT "liara_api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liara_usage_snapshots" ADD CONSTRAINT "liara_usage_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liara_key_provisioning_issues" ADD CONSTRAINT "liara_key_provisioning_issues_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quota_overrides" ADD CONSTRAINT "user_quota_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_packages" ADD CONSTRAINT "credit_packages_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_categories" ADD CONSTRAINT "creative_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "creative_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompts" ADD CONSTRAINT "creative_prompts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "creative_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompts" ADD CONSTRAINT "creative_prompts_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "creative_prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_pinnedPromptId_fkey" FOREIGN KEY ("pinnedPromptId") REFERENCES "creative_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompt_requests" ADD CONSTRAINT "creative_prompt_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompt_requests" ADD CONSTRAINT "creative_prompt_requests_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "creative_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_feedbacks" ADD CONSTRAINT "message_feedbacks_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_profiles" ADD CONSTRAINT "lead_profiles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caption_projects" ADD CONSTRAINT "caption_projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_issuedToUserId_fkey" FOREIGN KEY ("issuedToUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "limit_hit_events" ADD CONSTRAINT "limit_hit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "launch_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "article_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_device_tokens" ADD CONSTRAINT "admin_device_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_campaigns" ADD CONSTRAINT "push_campaigns_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_sessions" ADD CONSTRAINT "anonymous_sessions_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "anonymous_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_conversations" ADD CONSTRAINT "anonymous_conversations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "anonymous_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_messages" ADD CONSTRAINT "anonymous_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "anonymous_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_funnel_events" ADD CONSTRAINT "anonymous_funnel_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "anonymous_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_profiles" ADD CONSTRAINT "nutrition_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_edit_sessions" ADD CONSTRAINT "video_edit_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "video_edit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_kieVideoModelId_fkey" FOREIGN KEY ("kieVideoModelId") REFERENCES "kie_video_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_clonedFromStoreId_fkey" FOREIGN KEY ("clonedFromStoreId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bank_cards" ADD CONSTRAINT "store_bank_cards_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "canonical_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_types" ADD CONSTRAINT "product_option_types_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_optionTypeId_fkey" FOREIGN KEY ("optionTypeId") REFERENCES "product_option_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_enrichment_drafts" ADD CONSTRAINT "product_enrichment_drafts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_kb_entries" ADD CONSTRAINT "store_kb_entries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_kb_entries" ADD CONSTRAINT "store_kb_entries_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_automation_rules" ADD CONSTRAINT "instagram_automation_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_shipping_rules" ADD CONSTRAINT "store_shipping_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_conversations" ADD CONSTRAINT "sales_conversations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_conversations" ADD CONSTRAINT "sales_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage_events" ADD CONSTRAINT "credit_usage_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage_events" ADD CONSTRAINT "credit_usage_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_change_logs" ADD CONSTRAINT "content_change_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_bankCardId_fkey" FOREIGN KEY ("bankCardId") REFERENCES "store_bank_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "store_discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_discount_codes" ADD CONSTRAINT "store_discount_codes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_discount_codes" ADD CONSTRAINT "store_discount_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

