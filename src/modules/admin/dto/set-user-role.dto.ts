import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class SetUserRoleDto {
  @IsIn(['USER', 'ADMIN'])
  role!: 'USER' | 'ADMIN';

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}
