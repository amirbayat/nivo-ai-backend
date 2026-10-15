import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

// R1.5 — whitelist برای بدنه‌هایی که مستقیم به prisma می‌رفتند (segments / topics)
export class CreateSegmentDto {
  @IsString()
  @MaxLength(100)
  label!: string;

  @IsOptional() @ToNumber() @IsInt() @Min(0) minMessagesPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) maxMessagesPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) minTokensPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) maxTokensPerDay?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional() @ToNumber() @IsInt() sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSegmentDto {
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @ToNumber() @IsInt() @Min(0) minMessagesPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) maxMessagesPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) minTokensPerDay?: number | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) maxTokensPerDay?: number | null;
  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
  @IsOptional() @ToNumber() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateTopicDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Type(() => String)
  keywords!: string[];

  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
  @IsOptional() @ToNumber() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTopicDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  keywords?: string[];
  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
  @IsOptional() @ToNumber() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
