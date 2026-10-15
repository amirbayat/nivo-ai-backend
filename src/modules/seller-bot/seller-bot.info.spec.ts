import { SellerBotController } from './seller-bot.controller';
import { SellerBotService } from './seller-bot.service';

function build(username?: string) {
  const config = {
    get: (k: string) => (k === 'SELLER_BOT_USERNAME' ? username : undefined),
  };
  const svc = new SellerBotService(
    {} as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return new SellerBotController(svc);
}

describe('GET v2/seller-bot/info [R2.3]', () => {
  it('نام بات را از کانفیگ بک‌اند می‌دهد (@ حذف می‌شود)', () => {
    expect(build('@nivo_seller_bot').info()).toEqual({
      username: 'nivo_seller_bot',
    });
  });
  it('بدون env مقدار null می‌دهد', () => {
    expect(build(undefined).info()).toEqual({ username: null });
    expect(build('  ').info()).toEqual({ username: null });
  });
});
