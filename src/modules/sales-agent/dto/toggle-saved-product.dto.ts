import { IsString, MaxLength, MinLength } from 'class-validator';

export class ToggleSavedProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  productId: string;
}
