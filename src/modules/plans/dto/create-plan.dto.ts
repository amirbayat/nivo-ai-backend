import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { fa } from '../../../i18n/fa';
import { REASONING_EFFORT_VALUES } from '../reasoning-effort.constants';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class CreatePlanDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  name: string;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  priceMonthly: number; // تومان

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  dailyFreeTokens: number;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  monthlyTotalTokens: number;

  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true, message: fa.validation.required })
  allowedModels: string[];

  @IsOptional()
  @IsObject({ message: fa.validation.required })
  features?: Record<string, unknown>;

  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive: boolean;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  sortOrder: number;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isPopular?: boolean;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true, message: fa.validation.required })
  featuredModels?: string[];

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  featuredModelsCount?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  dailyMessageLimit?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  maxInputTokens?: number;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  outputThrottleSteps?: { afterMessages: number; maxOutputTokens: number }[];

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  throttledMessageCount?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  throttledInputTokens?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  throttledOutputTokens?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  rollingWindowLimit?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  rollingWindowHours?: number;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  contextMd?: string;

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  reasoningEffort?: string | null;

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  fastReasoningEffort?: string | null;

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES, { message: fa.validation.required })
  smartReasoningEffort?: string | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  trialMessageThreshold?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  trialDailyMessageLimit?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  trialThrottledMessageCount?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  trialRollingWindowLimit?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  trialRollingWindowHours?: number | null;

  // docs/PRD-pay-as-you-go-wallet.md
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isPayAsYouGo?: boolean;

  @IsOptional()
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  payAsYouGoMarkup?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  payAsYouGoMinActivationToman?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  payAsYouGoMinTopupToman?: number;

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsInt({ each: true, message: fa.validation.mustBeNumber })
  @ToNumber()
  payAsYouGoTopupPresets?: number[];

  // تنظیمات تولید/ویرایش عکس مخصوص این پلن
  @IsOptional()
  @IsString({ message: fa.validation.required })
  defaultImageGenModel?: string | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  maxImageGenPerDay?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  maxImageGenPerWindow?: number | null;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  imageGenWindowHours?: number | null;
}
