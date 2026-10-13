import { buildChatMessages } from './chat-messages';

describe('buildChatMessages', () => {
  it('پیام فعلی همیشه آخرین user است', () => {
    expect(buildChatMessages([], 'سلام')).toEqual([
      { role: 'user', content: 'سلام' },
    ]);
  });

  it('assistant ابتدایی حذف و هم‌نقش‌های پشت‌سرهم ادغام می‌شوند', () => {
    const out = buildChatMessages(
      [
        { role: 'assistant', text: 'خوش اومدی' },
        { role: 'user', text: 'سلام' },
        { role: 'user', text: 'شال دارید؟' },
        { role: 'assistant', text: 'بله' },
      ],
      'قیمتش؟',
    );
    expect(out).toEqual([
      { role: 'user', content: 'سلام\nشال دارید؟' },
      { role: 'assistant', content: 'بله' },
      { role: 'user', content: 'قیمتش؟' },
    ]);
  });

  it('اگر آخرین history هم user بود با پیام فعلی ادغام می‌شود (alternation)', () => {
    const out = buildChatMessages([{ role: 'user', text: 'الو' }], 'هستید؟');
    expect(out).toEqual([{ role: 'user', content: 'الو\nهستید؟' }]);
  });

  it('متن خالی نادیده گرفته می‌شود', () => {
    expect(buildChatMessages([{ role: 'user', text: '  ' }], 'x')).toEqual([
      { role: 'user', content: 'x' },
    ]);
  });
});
