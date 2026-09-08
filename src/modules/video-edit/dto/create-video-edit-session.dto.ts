import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVideoEditSessionDto {
  // اختیاری — نیامدنش یعنی session بی‌عنوان (اولین job عنوانش را از پرامپت پر می‌کند)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
