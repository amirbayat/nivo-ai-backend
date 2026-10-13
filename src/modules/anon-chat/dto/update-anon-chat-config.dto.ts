import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REASONING_EFFORT_VALUES } from '../../plans/reasoning-effort.constants';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdateAnonChatConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string;

  @IsOptional()
  @IsIn(REASONING_EFFORT_VALUES)
  reasoningEffort?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  @ToNumber()
  freeMessageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  @ToNumber()
  dailyMessageLimitAfterFree?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(20_000)
  @ToNumber()
  maxInputTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(20_000)
  @ToNumber()
  maxOutputTokens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  signupBannerMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  limitedZoneMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  blockedMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hintTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  hintSubtitle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  @ToNumber()
  signupBannerAfterMessages?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  samplePrompts?: string[];
}
