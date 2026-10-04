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
import { IRAN_PROVINCES } from '../../../common/constants/iran-provinces';

// دکمه‌های UiBlock به‌جای ساختن جمله‌ی فارسی (که دوباره از parseIntent رد می‌شد)، این
// ساختار قطعی را می‌فرستند — یا message یا action، هیچ‌وقت هیچ‌کدام
export class SalesActionDto {
  @IsIn([
    'ADD_TO_CART',
    'CONFIRM_CART',
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — دکمه‌های فلوی آدرس
    'SELECT_ADDRESS',
    'NEW_ADDRESS',
    // بخش ۲ (فاز ۱.۵) — انتخاب استان دکمه‌ای
    'SELECT_PROVINCE',
    'CONFIRM_ADDRESS',
    'EDIT_ADDRESS',
    'SAVE_ADDRESS',
    'SKIP_SAVE_ADDRESS',
    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸) — همون سه نوع جدید
    // sales-agent.types.ts::SalesAction، اینجا هم باید whitelist شوند وگرنه ValidationPipe
    // رد می‌کند (باگ: دکمه‌ی «سفارش‌های من» با ۴۰۰ شکست می‌خورد)
    'VIEW_ORDERS',
    'TOGGLE_SAVE_PRODUCT',
    'REORDER',
    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — جواب چیپ VARIANT_PROMPT
    'SELECT_VARIANT_VALUE',
  ])
  type:
    | 'ADD_TO_CART'
    | 'CONFIRM_CART'
    | 'SELECT_ADDRESS'
    | 'NEW_ADDRESS'
    | 'SELECT_PROVINCE'
    | 'CONFIRM_ADDRESS'
    | 'EDIT_ADDRESS'
    | 'SAVE_ADDRESS'
    | 'SKIP_SAVE_ADDRESS'
    | 'VIEW_ORDERS'
    | 'TOGGLE_SAVE_PRODUCT'
    | 'REORDER'
    | 'SELECT_VARIANT_VALUE';

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

  @IsOptional()
  @IsIn(IRAN_PROVINCES)
  province?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  // فقط SELECT_VARIANT_VALUE — در mode=DIMENSION یک مقدار گزینه («M»)، در mode=ALTERNATIVES
  // یک شناسه‌ی ProductVariant (UUID)؛ همون @IsString ساده کافی است چون engine خودش هر دو
  // حالت را با دیتای واقعی محصول اعتبارسنجی می‌کند، نه فرمت رشته
  @IsOptional()
  @IsString()
  @MaxLength(200)
  value?: string;
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
