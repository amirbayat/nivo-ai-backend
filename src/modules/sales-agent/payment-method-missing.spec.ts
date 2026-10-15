import { ConversationEngineService } from './conversation-engine.service';

const SMS =
  'یه مشتری می‌خواد خرید کنه ولی روش پرداخت فروشگاهت ثبت نشده. از پنل ← کارت‌های بانکی اضافه کن.';

describe('paymentMethodMissing seller SMS [F14]', () => {
  const setup = (sellerBotChatId: string | null) => {
    const notifySeller = jest.fn().mockResolvedValue(undefined);
    const sendText = jest.fn().mockResolvedValue(undefined);
    const engine = Object.create(ConversationEngineService.prototype) as {
      paymentMethodMissing: (conversation: unknown) => Promise<unknown>;
    };
    Object.assign(engine, {
      persistTransition: jest.fn().mockResolvedValue(undefined),
      getContext: () => ({}),
      logReply: jest.fn().mockResolvedValue(undefined),
      sellerBotApi: { sendText },
      notifications: { notifySeller },
    });
    const conversation = {
      id: 'c1',
      storeId: 's1',
      store: { sellerBotChatId },
    };
    return { engine, conversation, notifySeller, sendText };
  };

  it('texts the seller when the bot is not connected', async () => {
    const { engine, conversation, notifySeller, sendText } = setup(null);
    await engine.paymentMethodMissing(conversation);
    expect(sendText).not.toHaveBeenCalled();
    expect(notifySeller).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 's1',
        template: 'PAYMENT_METHOD_MISSING',
        smsText: SMS,
        dedupe: {
          key: 'payment-method-missing:s1',
          ttlSeconds: 24 * 60 * 60,
        },
      }),
    );
  });

  it('keeps the Telegram alert when the bot is connected', async () => {
    const { engine, conversation, notifySeller, sendText } = setup('chat-1');
    await engine.paymentMethodMissing(conversation);
    expect(sendText).toHaveBeenCalled();
    expect(notifySeller).not.toHaveBeenCalled();
  });
});
