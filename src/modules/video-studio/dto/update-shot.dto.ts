import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateShotDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scenario?: string;

  @IsOptional()
  @IsBoolean()
  audioEnabled?: boolean;
}
