import { IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

// autosave — بخش ۵.۳ سند (localStorage + این PATCH). هر سه فیلد اختیاری‌اند چون فرانت فقط
// چیزی را می‌فرستد که واقعاً تغییر کرده (مثلاً فقط segments هنگام ادیت متن، یا فقط styleId
// هنگام تعویض قالب از گالری)
export class UpdateCaptionProjectDto {
  @IsOptional()
  @IsArray()
  segments?: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  styleId?: string;

  @IsOptional()
  @IsObject()
  styleOverrides?: Record<string, unknown>;
}
