import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetMediaId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  staticReplyText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  staticDmText?: string;

  @IsOptional()
  @IsBoolean()
  publicReplyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
