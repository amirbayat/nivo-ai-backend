import {
  RECEIPT_SLA_DAY_END_HOUR,
  RECEIPT_SLA_DAY_START_HOUR,
} from '../../common/constants/sales-ops.constants';

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

function tehranParts(date: Date): { y: number; m: number; d: number; minutes: number } {
  const local = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth(),
    d: local.getUTCDate(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function fromTehran(y: number, m: number, d: number, minutes: number): Date {
  const utc = Date.UTC(y, m, d, 0, minutes) - TEHRAN_OFFSET_MS;
  return new Date(utc);
}

// Add N hours that fall inside Tehran business hours (start inclusive, end exclusive).
export function addTehranBusinessHours(start: Date, hours: number): Date {
  const startMin = RECEIPT_SLA_DAY_START_HOUR * 60;
  const endMin = RECEIPT_SLA_DAY_END_HOUR * 60;
  let left = hours * 60;
  let cursor = new Date(start.getTime());
  for (let guard = 0; guard < 14 && left > 0; guard++) {
    const p = tehranParts(cursor);
    let minute = p.minutes;
    if (minute < startMin) minute = startMin;
    if (minute >= endMin) {
      cursor = fromTehran(p.y, p.m, p.d + 1, startMin);
      continue;
    }
    const room = endMin - minute;
    const step = Math.min(room, left);
    cursor = fromTehran(p.y, p.m, p.d, minute + step);
    left -= step;
  }
  return cursor;
}
