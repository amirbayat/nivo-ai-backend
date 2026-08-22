import { Gender, ActivityLevel, NutritionGoal } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';

// ویزارد آنبوردینگ فاز ۲ (docs/PRD-nivo-cal.md بخش ۳.۱) — weightKg اینجا فقط برای ساخت
// اولین رکورد WeightLog استفاده می‌شود، روی خود پروفایل ذخیره نمی‌شود (بخش ۴.۲)
export class CreateNutritionProfileDto {
  @IsEnum(Gender, { message: fa.validation.required })
  gender: Gender;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(10)
  @Max(100)
  age: number;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(100)
  @Max(250)
  heightCm: number;

  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(30)
  @Max(300)
  weightKg: number;

  @IsEnum(ActivityLevel, { message: fa.validation.required })
  activityLevel: ActivityLevel;

  @IsEnum(NutritionGoal, { message: fa.validation.required })
  goal: NutritionGoal;

  // فقط برای LOSE_WEIGHT/GAIN_WEIGHT معنا دارد؛ برای MAINTAIN نادیده گرفته می‌شود
  // (سرویس خودش ۱ پیش‌فرض می‌گیرد اگر نیامده باشد)
  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1)
  @Max(3)
  goalPaceLevel?: number;
}
