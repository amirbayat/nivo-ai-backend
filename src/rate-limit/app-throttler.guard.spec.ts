import express from 'express';
import request from 'supertest';
import { HttpException } from '@nestjs/common';
import { AppThrottlerGuard } from './app-throttler.guard';
import { SalesAgentService } from '../modules/sales-agent/sales-agent.service';
import { CHAT_START_LIMIT_PER_STORE_PER_MIN } from '../common/constants/sales-ops.constants';

// PRD-nivo-sales-unified.md تسک 0.10 — X-Forwarded-For جعلی نباید سقف rate limit را دور بزند
describe('AppThrottlerGuard tracker [0.10]', () => {
  const guard = Object.create(AppThrottlerGuard.prototype) as {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };

  it('بدون توکن: بر اساس req.ip، نه هدر XFF', async () => {
    const t = await guard.getTracker({
      headers: { 'x-forwarded-for': '9.9.9.9' },
      ip: '5.5.5.5',
      socket: { remoteAddress: '10.0.0.1' },
    });
    expect(t).toBe('ip:5.5.5.5');
  });

  it('XFF متفاوت با req.ip یکسان → همان tracker', async () => {
    const mk = (xff: string) =>
      guard.getTracker({ headers: { 'x-forwarded-for': xff }, ip: '5.5.5.5' });
    expect(await mk('1.1.1.1')).toBe(await mk('2.2.2.2'));
  });

  it('با trust proxy=1 اکسپرس، مقدار چپ XFF (جعلی) نادیده گرفته می‌شود', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    const a = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', 'fake1, 7.7.7.7');
    const b = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', 'fake2, 7.7.7.7');
    expect(a.body.ip).toBe('7.7.7.7');
    expect(b.body.ip).toBe('7.7.7.7');
  });
});

describe('SalesAgentService.startChat per-store limit [0.10]', () => {
  it('بعد از سقف per-store → 429 و بدون ساخت Customer', async () => {
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'st1', status: 'ACTIVE' }),
      },
      customer: { create: jest.fn() },
    };
    const redis = {
      incr: jest.fn().mockResolvedValue(CHAT_START_LIMIT_PER_STORE_PER_MIN + 1),
      expire: jest.fn(),
    };
    const svc = Object.create(SalesAgentService.prototype) as SalesAgentService;
    Object.assign(svc, { prisma, redis });
    const err = await svc.startChat('slug').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('اولین درخواست پنجره: expire ۶۰ثانیه تنظیم می‌شود', async () => {
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'st1', status: 'ACTIVE' }),
      },
    };
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() };
    const creditService = {
      grantTrialIfFirstChat: jest.fn().mockRejectedValue(new Error('stop')),
    };
    const svc = Object.create(SalesAgentService.prototype) as SalesAgentService;
    Object.assign(svc, { prisma, redis, creditService });
    await svc.startChat('slug').catch(() => undefined);
    expect(redis.expire).toHaveBeenCalledWith('rl:chat-start:st1', 60);
  });
});
