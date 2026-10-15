import { NotificationService } from './notification.service';

describe('notifySeller channel', () => {
  const build = (sellerBotChatId: string | null) => {
    const sendText = jest.fn(async () => undefined);
    const sendFreeText = jest.fn(async () => undefined);
    const svc = Object.create(NotificationService.prototype) as NotificationService;
    Object.assign(svc, {
      redis: { set: async () => 'OK' },
      prisma: {
        store: {
          findUnique: async () => ({
            sellerBotChatId,
            seller: { phone: '09120000000' },
          }),
        },
        notificationLog: { create: async () => ({}) },
      },
      sellerBotApi: { sendText },
      sms: { sendFreeText },
      logger: { error: jest.fn() },
    });
    return { svc, sendText, sendFreeText };
  };

  const input = {
    storeId: 's1',
    template: 'CREDIT_LOW',
    entityId: 's1',
    botText: 'bot',
    smsText: 'نیوو: اعتبار ایجنت فروش فروشگاهت رو به اتمامه. قبل از تموم‌شدن از پنل فروشنده شارژش کن.',
  };

  it('sends Telegram and skips SMS when the bot is connected', async () => {
    const { svc, sendText, sendFreeText } = build('chat-1');
    await svc.notifySeller(input);
    expect(sendText).toHaveBeenCalledWith('chat-1', 'bot');
    expect(sendFreeText).not.toHaveBeenCalled();
  });

  it('sends SMS when the bot is not connected', async () => {
    const { svc, sendText, sendFreeText } = build(null);
    await svc.notifySeller(input);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendFreeText).toHaveBeenCalledWith('09120000000', input.smsText);
  });
});
