import { IsOptional, IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

// یکی از این دو باید پر باشد — کنترلش داخل AuthService.createImpersonationCode است، نه اینجا
// (در این سطح هردو اختیاری‌اند، چون DTO نمی‌تواند «حداقل یکی» را به‌سادگی ولیدیت کند)
export class CreateImpersonationDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  userId?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  phone?: string;
}
