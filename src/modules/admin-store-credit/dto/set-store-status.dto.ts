import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class SetStoreStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}
