import { ConsoleLogger } from '@nestjs/common';
import { logCtx } from './log-context';

// لاگر پیش‌فرض Nest + پسوند logCtx() روی پیام‌های رشته‌ای
export class CtxLogger extends ConsoleLogger {
  private decorate(message: unknown): unknown {
    if (typeof message !== 'string') return message;
    const ctx = logCtx();
    return ctx ? `${message} ${ctx}` : message;
  }

  log(message: unknown, ...rest: unknown[]) {
    super.log(this.decorate(message), ...rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    super.warn(this.decorate(message), ...rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    super.error(this.decorate(message), ...rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    super.debug(this.decorate(message), ...rest);
  }
}
