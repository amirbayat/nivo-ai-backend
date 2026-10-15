import type { NextFunction, Request, Response } from 'express';
import { isShuttingDown } from '../shutdown-state';

// خواندن (GET/HEAD، از جمله خواندن جواب ذخیره‌شده‌ی turn در حال اتمام) آزاد؛ نوشتن جدید ۵۰۳
export function shutdownGuard(req: Request, res: Response, next: NextFunction) {
  if (isShuttingDown() && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ message: 'سرور در حال به‌روزرسانی است؛ چند ثانیه‌ی دیگر دوباره امتحان کن' });
    return;
  }
  next();
}
