import { resetAceConfigCache, updateAceSettings, getAceSettings } from './ace-config';
import { setAceRuntime } from './ace-runtime';
import { meterResponse } from './fetch-meter';
import { setLedgerSink } from './ledger-sink';

let row: { layers: unknown; params: unknown } | null = null;
beforeEach(() => {
  row = null;
  resetAceConfigCache();
  setAceRuntime({ redis: null, loadConfig: async () => row, saveConfig: async (d) => { row = d; } });
});
afterEach(() => setLedgerSink(null));

const mkRes = () => {
  const res = new Response(JSON.stringify({ model: 'm', usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 } }));
  const clone = jest.spyOn(res, 'clone');
  return { res, clone };
};

describe('meter و layers.ledger', () => {
  it('on → یک ردیف با engineMode', async () => {
    const rows: Array<Record<string, unknown>> = [];
    setLedgerSink((e) => rows.push(e as never));
    const { res } = mkRes();
    meterResponse('https://x/v1/chat/completions', { body: '{"model":"m"}' }, res, Date.now());
    await new Promise((r) => setTimeout(r, 5));
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ engineMode: 'stable' });
  });

  it('off → res.clone() اصلاً صدا نمی‌شود و ردیفی ثبت نمی‌شود', async () => {
    await updateAceSettings({ layers: { ledger: 'off' } }, 'a');
    await getAceSettings();
    const rows: unknown[] = [];
    setLedgerSink((e) => rows.push(e));
    const { res, clone } = mkRes();
    meterResponse('https://x/v1/chat/completions', undefined, res, Date.now());
    await new Promise((r) => setTimeout(r, 5));
    expect(clone).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
