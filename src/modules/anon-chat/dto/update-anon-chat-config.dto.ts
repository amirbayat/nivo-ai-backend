import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { REASONING_EFFORT_VALUES } from '../../plans/reasoning-effort.constants'

export class UpdateAnonChatConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES)
  reasoningEffort?: string | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  freeMessageLimit?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  dailyMessageLimitAfterFree?: number

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(20_000)
  maxInputTokens?: number

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(20_000)
  maxOutputTokens?: number

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  signupBannerMessage?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  limitedZoneMessage?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  blockedMessage?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hintTitle?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  hintSubtitle?: string
}
