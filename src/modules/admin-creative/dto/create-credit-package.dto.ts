import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CreditPackageScope } from '@prisma/client';
import { fa } from '../../../i18n/fa';

export class CreateCreditPackageDto {
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  credits: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  discountPercent?: number;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isPopular?: boolean;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isBestValue?: boolean;

  // کارت «مبلغ دلخواه» — وقتی فعال، credits به‌عنوان حداقل مجاز تفسیر می‌شود (بخش خرید بسته)
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isCustomAmount?: boolean;

  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CreditPackageScope, { message: fa.validation.required })
  scope?: CreditPackageScope;

  // شناسه‌ی محصول (SKU) این بسته در پیشخان کافه‌بازار — فقط برای بسته‌های ثابت
  // (isCustomAmount=false) معنا دارد؛ باید از قبل در پیشخان بازار ساخته شده باشد
  // (docs/PRD-nivo-cal-credits-ui.md بخش ۴)
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsString({ message: fa.validation.required })
  bazaarSku?: string;
}
