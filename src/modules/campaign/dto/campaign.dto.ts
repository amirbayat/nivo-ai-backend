import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

// R1.5 — فیلدهای قابل‌ویرایش کمپین؛ status/grantedCount/id عمداً نیست (فقط با مسیر خودشان عوض می‌شوند)
export class CampaignFieldsDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) maxWaitlistSize?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) waitlistMessage?: string;
  @IsOptional() @IsString() @MaxLength(2000) waitlistFullMessage?: string | null;
  @IsOptional() @ToNumber() @IsInt() @Min(0) @Max(100) waitlistDailyMessageLimit?: number;
  @IsOptional() @IsBoolean() displayCounterEnabled?: boolean;
  @IsOptional() @ToNumber() @IsInt() @Min(0) @Max(100) displayInitialPctMin?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) @Max(100) displayInitialPctMax?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) @Max(100) displayFloorMin?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) @Max(100) displayFloorMax?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(50) displayAnimationTickMs?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) displayDecrementMin?: number;
  @IsOptional() @ToNumber() @IsInt() @Min(0) displayDecrementMax?: number;
  @IsOptional() @IsString() @MaxLength(100) grantedSmsTemplate?: string | null;
}

export class CreateCampaignDto extends CampaignFieldsDto {
  @IsString() @MaxLength(200) declare name: string;
  @IsDateString() declare startAt: string;
  @ToNumber() @IsInt() @Min(0) declare capacity: number;
  @IsString() @MaxLength(2000) declare waitlistMessage: string;
}

export class UpdateCampaignDto extends CampaignFieldsDto {}
