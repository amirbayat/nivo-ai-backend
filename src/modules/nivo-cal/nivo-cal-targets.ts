import { Gender, ActivityLevel, NutritionGoal } from '@prisma/client';

// docs/PRD-nivo-cal.md بخش ۳.۲ — عمداً یک تابع خالص، بدون فراخوانی مدل: عددی که به کاربر
// «هدف کالری روزانه‌ات» می‌گوییم هیچ‌وقت نباید به توهم عددی یک مدل زبانی وابسته باشد.

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  ACTIVE: 1.55,
  VERY_ACTIVE: 1.725,
};

const PACE_DEFICIT_KCAL: Record<number, number> = { 1: 300, 2: 500, 3: 750 };
const PACE_SURPLUS_KCAL: Record<number, number> = { 1: 300, 2: 400, 3: 500 };

// سقف ایمنی — غیرقابل‌دور زدن، حتی با انتخاب سریع‌ترین سرعت کاهش/افزایش وزن
const MIN_SAFE_CALORIES: Record<Gender, number> = { MALE: 1500, FEMALE: 1200 };

const MACRO_SPLIT: Record<
  NutritionGoal,
  { protein: number; carbs: number; fat: number }
> = {
  // پروتئین بالاتر در کاهش وزن — حفظ توده‌ی عضلانی حین کسری کالری
  LOSE_WEIGHT: { protein: 0.35, carbs: 0.35, fat: 0.3 },
  MAINTAIN: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  GAIN_WEIGHT: { protein: 0.3, carbs: 0.45, fat: 0.25 },
};

export interface NutritionTargetsInput {
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
  goalPaceLevel?: number;
}

export interface NutritionTargets {
  dailyCalorieTarget: number;
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
}

export function computeNutritionTargets(
  input: NutritionTargetsInput,
): NutritionTargets {
  const { gender, age, heightCm, weightKg, activityLevel, goal } = input;
  const paceLevel = input.goalPaceLevel ?? 2;

  const bmr =
    gender === 'MALE'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;

  const tdee = bmr * ACTIVITY_FACTORS[activityLevel];

  let target: number;
  if (goal === 'LOSE_WEIGHT') {
    target = tdee - (PACE_DEFICIT_KCAL[paceLevel] ?? PACE_DEFICIT_KCAL[2]);
  } else if (goal === 'GAIN_WEIGHT') {
    target = tdee + (PACE_SURPLUS_KCAL[paceLevel] ?? PACE_SURPLUS_KCAL[2]);
  } else {
    target = tdee;
  }

  target = Math.max(target, MIN_SAFE_CALORIES[gender]);
  const dailyCalorieTarget = Math.round(target);

  const split = MACRO_SPLIT[goal];
  const proteinTargetG = Math.round((dailyCalorieTarget * split.protein) / 4);
  const carbsTargetG = Math.round((dailyCalorieTarget * split.carbs) / 4);
  const fatTargetG = Math.round((dailyCalorieTarget * split.fat) / 9);

  return { dailyCalorieTarget, proteinTargetG, carbsTargetG, fatTargetG };
}
