import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export const ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED'] as const

export class CreateArticleDto {
  @IsString()
  @MinLength(1)
  title!: string

  @IsOptional()
  @IsString()
  slug?: string

  @IsOptional()
  @IsString()
  metaDescription?: string

  @IsOptional()
  @IsString()
  coverImageUrl?: string

  @IsString()
  contentMd!: string

  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: (typeof ARTICLE_STATUSES)[number]

  @IsOptional()
  @IsBoolean()
  isPinnedInBanner?: boolean
}

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string

  @IsOptional()
  @IsString()
  slug?: string

  @IsOptional()
  @IsString()
  metaDescription?: string

  @IsOptional()
  @IsString()
  coverImageUrl?: string

  @IsOptional()
  @IsString()
  contentMd?: string

  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: (typeof ARTICLE_STATUSES)[number]

  @IsOptional()
  @IsBoolean()
  isPinnedInBanner?: boolean
}
