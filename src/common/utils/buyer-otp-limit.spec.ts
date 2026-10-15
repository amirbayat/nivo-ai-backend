import { buyerOtpSendBlock } from './buyer-otp-limit';

function redisReturning(counts: Record<string, number>) {
  return {
    incr: async (key: string) => {
      counts[key] = (counts[key] ?? 0) + 1;
      return counts[key];
    },
    expire: async () => 1,
  };
}

describe('buyerOtpSendBlock', () => {
  it('blocks the 6th send to one number within the hour', async () => {
    const redis = redisReturning({});
    let last: string | null = null;
    for (let i = 0; i < 6; i++) {
      last = await buyerOtpSendBlock(redis, `store-${i}`, '09120000000', `10.0.0.${i}`);
    }
    expect(last).toBe('phone');
  });

  it('blocks the 21st send from one IP within the hour', async () => {
    const redis = redisReturning({});
    let last: string | null = null;
    for (let i = 0; i < 21; i++) {
      last = await buyerOtpSendBlock(redis, 'store', `0912000${String(i).padStart(4, '0')}`, '203.0.113.8');
    }
    expect(last).toBe('ip');
  });

  it('still blocks the 4th send for the same store and number', async () => {
    const redis = redisReturning({});
    let last: string | null = null;
    for (let i = 0; i < 4; i++) {
      last = await buyerOtpSendBlock(redis, 'store', '09121111111', `198.51.100.${i}`);
    }
    expect(last).toBe('store');
  });
});
