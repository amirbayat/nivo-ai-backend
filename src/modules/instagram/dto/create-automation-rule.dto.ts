import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AutomationTriggerType } from '@prisma/client';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۴.۲ — مشترک بین هر دو ریجن،
// پس عمداً بدون پیام اعتبارسنجی fa/en هاردکد (هر کنترلر زبان خودش را دارد)
export class CreateAutomationRuleDto {
  @IsEnum(AutomationTriggerType)
  triggerType: AutomationTriggerType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetMediaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  staticReplyText?: string;

  @IsString()
  @MaxLength(2000)
  staticDmText: string;

  @IsOptional()
  @IsBoolean()
  publicReplyEnabled?: boolean;
}
