import { IsOptional, IsString, Matches } from 'class-validator';

export class SubscribeStockAlertDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  productId: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  variantId?: string;
}
