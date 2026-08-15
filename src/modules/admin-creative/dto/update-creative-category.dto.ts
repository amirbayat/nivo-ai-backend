import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID } from 'class-validator'
import { fa } from '../../../i18n/fa'

export class UpdateCreativeCategoryDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  parentId?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive?: boolean
}
