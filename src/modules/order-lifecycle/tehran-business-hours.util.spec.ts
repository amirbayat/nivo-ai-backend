import { addTehranBusinessHours } from './tehran-business-hours.util';

describe('addTehranBusinessHours', () => {
  it('carries evening hours into the next morning', () => {
    // 21:00 Tehran is 17:30 UTC. 1h until 22:00, then 2h from 08:00 → 10:00 Tehran.
    const start = new Date('2026-10-13T17:30:00.000Z');
    const end = addTehranBusinessHours(start, 3);
    const tehran = new Date(end.getTime() + 3.5 * 60 * 60 * 1000);
    expect(tehran.getUTCHours()).toBe(10);
    expect(tehran.getUTCDate()).toBe(14);
  });
});
