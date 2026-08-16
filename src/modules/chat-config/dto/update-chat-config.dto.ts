import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const CHAT_IMAGE_FORMATS = ['png', 'jpeg', 'webp', 'gif'] as const;

export class UpdateChatConfigDto {
  @IsOptional()
  @IsString()
  globalContextMd?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100_000)
  summaryTriggerTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(4096)
  summaryMaxTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxImagesPerMessage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxImageSizeMb?: number;

  @IsOptional()
  @IsArray()
  @IsIn(CHAT_IMAGE_FORMATS, { each: true })
  allowedImageFormats?: string[];

  // docs/PRD-chat-images.md — تشخیص خودکار نیت تولید عکس وسط چت معمولی، بدون toggle صریح کاربر
  @IsOptional()
  @IsBoolean()
  implicitImageGenEnabled?: boolean;
}
