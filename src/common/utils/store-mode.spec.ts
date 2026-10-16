import { isNivoLeadStore } from './store-mode';

describe('isNivoLeadStore', () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])('leadCaptureOnly=%s isDemo=%s → %s', (leadCaptureOnly, isDemo, expected) => {
    expect(isNivoLeadStore({ leadCaptureOnly, isDemo })).toBe(expected);
  });

  it('isDemo ناموجود (select ناقص) فروشگاه لید را لید می‌داند', () => {
    expect(isNivoLeadStore({ leadCaptureOnly: true })).toBe(true);
  });
});
