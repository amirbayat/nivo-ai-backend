import { csvEscape, parseImportNumber, planVariantSync, variantComboKey } from './seller-catalog.util';

describe('seller catalog guards [0.13i][0.13l][0.13m]', () => {
  it('keeps the variant id when the same options are saved again', () => {
    const plan = planVariantSync(
      [{ id: 'keep', optionValues: { color: 'red', size: 'M' } }],
      [{ optionValues: { size: 'M', color: 'red' } }],
    );
    expect(plan.updates).toEqual([{ id: 'keep', index: 0 }]);
    expect(plan.creates).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(variantComboKey({ size: 'M', color: 'red' })).toBe(
      variantComboKey({ color: 'red', size: 'M' }),
    );
  });

  it('deletes only a combination the seller removed', () => {
    const plan = planVariantSync(
      [
        { id: 'stay', optionValues: { size: 'S' } },
        { id: 'gone', optionValues: { size: 'M' } },
      ],
      [{ optionValues: { size: 'S' } }, { optionValues: { size: 'L' } }],
    );
    expect(plan.updates.map((row) => row.id)).toEqual(['stay']);
    expect(plan.creates).toEqual([1]);
    expect(plan.deleteIds).toEqual(['gone']);
  });

  it('reads a Persian price with a thousands separator', () => {
    expect(parseImportNumber('۱۲۰,۰۰۰ تومان')).toBe(120000);
    expect(parseImportNumber('120,000')).toBe(120000);
    expect(parseImportNumber('')).toBeUndefined();
  });

  it('prefixes a spreadsheet formula so Excel does not run it', () => {
    expect(csvEscape('=HYPERLINK(1)')).toBe("'=HYPERLINK(1)");
    expect(csvEscape('plain')).toBe('plain');
  });
});
