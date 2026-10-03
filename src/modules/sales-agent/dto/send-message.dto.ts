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
  @IsIn([
    'ADD_TO_CART',
    'CONFIRM_CART',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — دکمه‌های فلوی آدرس
    'SELECT_ADDRESS',
    'NEW_ADDRESS',
    'CONFIRM_ADDRESS',
    'EDIT_ADDRESS',
    'SAVE_ADDRESS',
    'SKIP_SAVE_ADDRESS',
  ])
  type:
    | 'ADD_TO_CART'
    | 'CONFIRM_CART'
    | 'SELECT_ADDRESS'
    | 'NEW_ADDRESS'
    | 'CONFIRM_ADDRESS'
    | 'EDIT_ADDRESS'
    | 'SAVE_ADDRESS'
    | 'SKIP_SAVE_ADDRESS';

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;

  @IsOptional()
  @IsString()
  addressId?: string;
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
