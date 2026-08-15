import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID } from 'class-validator'
import { fa } from '../../../i18n/fa'

// ادمین از این‌جا درخت دسته‌بندی دیسکاوری را می‌سازد (مثلاً اینستاگرام › کاور پست) —
// parentId خالی یعنی این یک دسته‌ی ریشه است
export class CreateCreativeCategoryDto {
  @IsString({ message: fa.validation.required })
  name: string

  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  parentId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive?: boolean
}
