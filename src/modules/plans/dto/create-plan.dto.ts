import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { fa } from '../../../i18n/fa'

export class CreatePlanDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  name: string

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  priceMonthly: number

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
}
