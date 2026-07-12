import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateArticleCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string

  @IsOptional()
  @IsString()
  slug?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UpdateArticleCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @IsOptional()
  @IsString()
  slug?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
