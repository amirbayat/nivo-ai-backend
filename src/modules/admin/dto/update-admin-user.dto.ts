import { IsBoolean, IsOptional } from 'class-validator';

// R1.5 — فقط فیلدهای مجاز؛ role عمداً اینجا نیست (endpoint جدا با audit)
export class UpdateAdminUserDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
