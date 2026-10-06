import { IsString } from 'class-validator';

export class ConnectInstagramDto {
  @IsString()
  code: string;
}
