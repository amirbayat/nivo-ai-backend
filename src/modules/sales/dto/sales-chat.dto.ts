import { IsString, IsOptional, IsArray, IsNumber, IsBoolean, ValidateNested, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

export class SalesChatMessageDto {
  @IsString()
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant'

  @IsString()
  content: string
}

export class SalesChatDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesChatMessageDto)
  messages: SalesChatMessageDto[]

  @IsString()
  sessionId: string
}

export const CTA_CLICK_TYPES = ['free_start', 'pricing'] as const

export class TrackCtaClickDto {
  @IsString()
  @IsIn(CTA_CLICK_TYPES)
  type: (typeof CTA_CLICK_TYPES)[number]
}

export class SaveLeadDto {
  @IsOptional()
  @IsString()
  sessionId?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsNumber()
  age?: number

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  jobTitle?: string

  @IsOptional()
  @IsArray()
  interests?: string[]

  @IsOptional()
  @IsArray()
  chatHistory?: SalesChatMessageDto[]

  @IsOptional()
  @IsString()
  recommendedPlan?: string

  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsBoolean()
  discountRequested?: boolean
}
