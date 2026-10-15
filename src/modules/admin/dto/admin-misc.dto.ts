import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetManualLimitDto {
  @IsIn(['daily', '1h', '3h', '6h'])
  type!: 'daily' | '1h' | '3h' | '6h';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ChangeUserPlanDto {
  @IsString()
  @MinLength(1)
  planId!: string;
}

export class TicketReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}

export class EnrichmentDraftDto {
  @IsIn(['WEB_SEARCH', 'ADMIN_RESOURCE'])
  source!: 'WEB_SEARCH' | 'ADMIN_RESOURCE';

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  resourceText?: string;
}
