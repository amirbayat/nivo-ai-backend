import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// docs/PRD-product-display-focus-and-variations.md §۴.۱ — فاز ۱ حداکثر ۲ بعد (سایز/رنگ) به‌ازای
// محصول کافی‌ست؛ جدول ترکیب‌ها در پنل همیشه یک‌جا جایگزین می‌شود (نه patch تدریجی)
export class ProductOptionTypeInputDto {
  @IsString()
  @MaxLength(40)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  values: string[];
}

export class ProductVariantInputDto {
  // کلید = نام یکی از optionTypes بالا، مقدار = یکی از values همان بعد — اعتبارسنجی دقیق
  // (که همه‌ی کلیدها/مقادیر واقعاً با optionTypes همین payload جور باشند) در سرویس انجام
  // می‌شود، چون class-validator برای Record با کلید دینامیک ابزار مناسبی ندارد
  @IsObject()
  optionValues: Record<string, string>;

  @IsInt()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceOverride?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;
}

export class ReplaceProductVariantsDto {
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionTypeInputDto)
  optionTypes: ProductOptionTypeInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants: ProductVariantInputDto[];
}
