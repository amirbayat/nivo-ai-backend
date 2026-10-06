import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳ — جدا از JwtPayload (phone-based،
// ۱۹۰+ جای استفاده در کل پروژه)؛ عمداً تایپ/دکوریتور مجزا تا هیچ تغییری روی مسیر ایرانی لازم نشود
export class IntlJwtPayload {
  sub: string; // User.id
  email: string;
  storeId: string;
}

export const CurrentIntlUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IntlJwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: IntlJwtPayload }>();
    return request.user;
  },
);
