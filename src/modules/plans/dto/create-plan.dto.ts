import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { fa } from '../../../i18n/fa'
import { REASONING_EFFORT_VALUES } from '../reasoning-effort.constants'

export class CreatePlanDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  name: string

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  priceMonthly: number // تومان

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  dailyFreeTokens: number

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  monthlyTotalTokens: number

  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true, message: fa.validation.required })
  allowedModels: string[]

  @IsOptional()
  @IsObject({ message: fa.validation.required })
  features?: Record<string, unknown>

  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive: boolean

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  sortOrder: number

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isPopular?: boolean

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true, message: fa.validation.required })
  featuredModels?: string[]

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  featuredModelsCount?: number

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  dailyMessageLimit?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  maxInputTokens?: number

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  outputThrottleSteps?: { afterMessages: number; maxOutputTokens: number }[]

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  throttledMessageCount?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  throttledInputTokens?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  throttledOutputTokens?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  rollingWindowLimit?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  rollingWindowHours?: number

  @IsOptional()
  @IsString({ message: fa.validation.required })
  contextMd?: string

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  reasoningEffort?: string | null

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  fastReasoningEffort?: string | null

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  smartReasoningEffort?: string | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  trialMessageThreshold?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  trialDailyMessageLimit?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  trialThrottledMessageCount?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  trialRollingWindowLimit?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  trialRollingWindowHours?: number | null

  // docs/PRD-pay-as-you-go-wallet.md
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isPayAsYouGo?: boolean

  @IsOptional()
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  payAsYouGoMarkup?: number

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  payAsYouGoMinActivationToman?: number

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  payAsYouGoMinTopupToman?: number

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsInt({ each: true, message: fa.validation.mustBeNumber })
  payAsYouGoTopupPresets?: number[]

  // تنظیمات تولید/ویرایش عکس مخصوص این پلن
  @IsOptional()
  @IsString({ message: fa.validation.required })
  defaultImageGenModel?: string | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  maxImageGenPerDay?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  maxImageGenPerWindow?: number | null

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  imageGenWindowHours?: number | null
}
