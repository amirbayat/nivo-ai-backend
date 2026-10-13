import express from 'express';
import request from 'supertest';
import { configureBodyParsers } from './body-parsers';

function makeApp() {
  const app = express();
  configureBodyParsers(app as never);
  app.post('/*splat', (req, res) => {
    res.json({
      ok: true,
      hasRaw: Buffer.isBuffer((req as never as { rawBody?: Buffer }).rawBody),
    });
  });
  // خطای body-parser (۴۱۳) را به‌صورت status برگردان
  app.use(
    (
      err: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.status ?? 500).json({ error: true });
    },
  );
  return app;
}

const bigJson = (bytes: number) => ({ pad: 'x'.repeat(bytes) });

describe('2.6 — سقف بدنه‌ی JSON', () => {
  it('مسیر عادی: بدنه‌ی بالای ۱MB رد می‌شود (413)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/stores/s1/products')
      .send(bigJson(1_200_000));
    expect(res.status).toBe(413);
  });

  it('مسیر عادی: بدنه‌ی کوچک پذیرفته می‌شود و rawBody ست است', async () => {
    const res = await request(makeApp())
      .post('/api/v1/instagram/webhook')
      .send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body.hasRaw).toBe(true);
  });

  it('مسیر آپلود (chat): بدنه‌ی ۳MB پذیرفته می‌شود', async () => {
    const res = await request(makeApp())
      .post('/api/v1/chat/stream')
      .send(bigJson(3_000_000));
    expect(res.status).toBe(200);
  });

  it('مسیر آپلود: بالای ۲۰MB رد می‌شود', async () => {
    const res = await request(makeApp())
      .post('/api/v1/chat/stream')
      .send(bigJson(21 * 1024 * 1024));
    expect(res.status).toBe(413);
  });
});
