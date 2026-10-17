import { aceNote, aceTraceInfo, runWithAceTurn, withCallSite } from './ace-context';

describe('aceNote', () => {
  it('بیرون از نوبت بی‌اثر و engine=stable', () => {
    aceNote('memo', 'x');
    expect(aceTraceInfo()).toEqual({ engine: 'stable', used: [] });
  });

  it('یادداشت‌ها بین callSiteهای تودرتو مشترک و بدون تکرار است', () => {
    runWithAceTurn(
      () => {
        withCallSite('faq_pick', () => aceNote('subcallDiet', 'سبک'));
        withCallSite('faq_pick', () => aceNote('subcallDiet', 'سبک'));
        aceNote('promptCache', 'ساختار قابل‌کش');
        const info = aceTraceInfo();
        expect(info.engine).toBe('lean');
        expect(info.used).toEqual([
          { layer: 'subcallDiet', reason: 'سبک', callSite: 'faq_pick' },
          { layer: 'promptCache', reason: 'ساختار قابل‌کش' },
        ]);
      },
      { engine: 'lean' },
    );
  });
});
