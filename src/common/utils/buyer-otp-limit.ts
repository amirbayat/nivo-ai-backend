type Counter = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

async function overLimit(
  redis: Counter,
  key: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > max;
}

export type BuyerOtpBlock = 'phone' | 'ip' | 'store';

// Store+number stays at 3 per 10 minutes. On top of that: 5 per hour per number,
// and 20 per hour per IP.
export async function buyerOtpSendBlock(
  redis: Counter,
  storeId: string,
  phone: string,
  ip: string | undefined,
): Promise<BuyerOtpBlock | null> {
  if (await overLimit(redis, `shopBuyerOtp:global:phone:${phone}`, 3600, 5)) {
    return 'phone';
  }
  if (
    ip &&
    (await overLimit(redis, `shopBuyerOtp:global:ip:${ip}`, 3600, 20))
  ) {
    return 'ip';
  }
  if (await overLimit(redis, `shopBuyerOtp:rate:${storeId}:${phone}`, 600, 3)) {
    return 'store';
  }
  return null;
}
