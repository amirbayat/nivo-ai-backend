import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { fa } from '../../../i18n/fa'

export class UpdateRoutingConfigDto {
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  enabled?: boolean

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  simpleKeywords?: string[]

  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  complexKeywords?: string[]

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  complexLenThreshold?: number

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  llmFallbackEnabled?: boolean

  @IsOptional()
  @IsString({ message: fa.validation.required })
  llmFallbackModel?: string
}
