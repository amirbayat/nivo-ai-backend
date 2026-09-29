import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// دکمه‌های UiBlock به‌جای ساختن جمله‌ی فارسی (که دوباره از parseIntent رد می‌شد)، این
// ساختار قطعی را می‌فرستند — یا message یا action، هیچ‌وقت هیچ‌کدام
export class SalesActionDto {
  @IsIn(['ADD_TO_CART', 'CONFIRM_CART'])
  type: 'ADD_TO_CART' | 'CONFIRM_CART';

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;
}

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SalesActionDto)
  action?: SalesActionDto;
}
