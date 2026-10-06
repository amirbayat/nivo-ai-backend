import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class IntlJwtGuard extends AuthGuard('intl-jwt') {}
