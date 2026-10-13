import {
  hashOrderToken,
  signOrderToken,
  verifyOrderToken,
} from './order-link.util';

describe('order link token', () => {
  const secret = 'test-secret';

  it('round-trips and rejects another order and a bad signature', () => {
    const exp = Date.now() + 60_000;
    const token = signOrderToken('order-a', exp, secret);
    expect(verifyOrderToken(token, secret)?.orderId).toBe('order-a');
    expect(verifyOrderToken(token, 'other')).toBeNull();
    const tampered = token.replace('order-a', 'order-b');
    expect(verifyOrderToken(tampered, secret)).toBeNull();
    expect(hashOrderToken(token)).toHaveLength(64);
  });

  it('rejects an expired token', () => {
    const token = signOrderToken('order-a', Date.now() - 1000, secret);
    expect(verifyOrderToken(token, secret)).toBeNull();
  });
});
