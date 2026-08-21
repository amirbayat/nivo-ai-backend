import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// تولید از یک CreativePrompt (سبک آماده‌ی دیسکاوری) — عکس یا متن، بسته به outputType خودِ سبک
export class GenerateCreativeDto {
  @IsUUID(undefined, { message: fa.validation.required })
  promptId: string;

  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  projectId?: string;

  // ورودی متنی کاربر که داخل CreativePrompt.userPromptTemplate جای‌گذاری می‌شود
  // (مثلاً موضوع کپشن، یا توضیح سبک دلخواه روی یک قالب کاور)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  userInput?: string;

  // کلیدهای MinIO عکس(های) از‌قبل‌آپلودشده‌ی کاربر — الزامی فقط برای سبک‌های requiresUserImage=true،
  // برای بقیه‌ی سبک‌های outputType=IMAGE اختیاری است (اگر بیاید، edit/ترکیب به‌جای تولید از صفر)
  @IsOptional()
  @IsArray({ message: fa.validation.mustBeArray })
  @IsString({ each: true })
  inputImageKeys?: string[];

  // انتخاب مدل از دراپ‌داون هدر چت — نام مدل واقعی یا یکی از سنتینل‌های خودکار
  // ('cost_optimized' | 'best_answer' | 'optimal'). فقط وقتی prompt.preferredModel خالی
  // باشد اثر دارد — کیوریشن ادمین همیشه اولویت دارد.
  @IsOptional()
  @IsString()
  model?: string;
}
