import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator'

export const SALES_KB_KINDS = ['EXAMPLE', 'OBJECTION', 'FAQ', 'PERSONA_GUIDANCE'] as const

export class CreateSalesKbEntryDto {
  @IsIn(SALES_KB_KINDS)
  kind!: (typeof SALES_KB_KINDS)[number]

  @IsString()
  @MinLength(1)
  label!: string

  @IsOptional()
  @IsArray()
  tags?: string[]

  @IsString()
  @MinLength(1)
  userMessage!: string

  @IsString()
  @MinLength(1)
  assistantReply!: string

  @IsOptional()
  @IsString()
  note?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UpdateSalesKbEntryDto {
  @IsOptional()
  @IsIn(SALES_KB_KINDS)
  kind?: (typeof SALES_KB_KINDS)[number]

  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string

  @IsOptional()
  @IsArray()
  tags?: string[]

  @IsOptional()
  @IsString()
  @MinLength(1)
  userMessage?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  assistantReply?: string

  @IsOptional()
  @IsString()
  note?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class BulkImportSalesKbDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesKbEntryDto)
  entries!: CreateSalesKbEntryDto[]
}

export class TestRetrievalDto {
  @IsString()
  @MinLength(1)
  sampleMessage!: string
}
