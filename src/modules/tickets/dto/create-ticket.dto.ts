import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { TicketPriority } from '@prisma/client'
import { fa } from '../../../i18n/fa'

export class CreateTicketDto {
  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  subject: string

  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(5000, { message: fa.validation.stringTooLong })
  body: string

  @IsOptional()
  @IsEnum(TicketPriority, { message: fa.validation.required })
  priority?: TicketPriority
}
