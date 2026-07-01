import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { TicketPriority, TicketStatus } from '@prisma/client'
import { fa } from '../../../i18n/fa'

export class UpdateTicketStatusDto {
  @IsOptional()
  @IsEnum(TicketStatus, { message: fa.validation.required })
  status?: TicketStatus

  @IsOptional()
  @IsEnum(TicketPriority, { message: fa.validation.required })
  priority?: TicketPriority

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  adminNote?: string
}
