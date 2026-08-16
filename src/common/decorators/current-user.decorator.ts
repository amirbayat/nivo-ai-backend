import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export class JwtPayload {
  sub: string;
  phone: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
