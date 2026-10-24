import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asksForTime, freeSlots, type Interval } from '../src/main/core/slots';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime(); // October 2026
const hhmm = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const show = (xs: Interval[]) => xs.map((s) => `${hhmm(s.start)}-${hhmm(s.end).split(' ')[1]}`);

describe('free meeting slots', () => {
  // Monday Oct 26 2026, 8:00.
  const monday8 = new Date(2026, 9, 26, 8, 0);

  it('offers one slot per working day, inside working hours, after the lead time', () => {
    assert.deepEqual(show(freeSlots([], monday8)), ['26 10:00-11:00', '27 9:00-10:00', '28 9:00-10:00']);
  });
  it('skips busy blocks and gaps that are too short', () => {
    const busy = [
      { start: at(26, 10), end: at(26, 12, 10) }, // gap 12:10 → 12:30 round-up
      { start: at(26, 12, 40), end: at(26, 15) }, // only 10 minutes free before this
      { start: at(27, 9), end: at(27, 17) }, // Tuesday fully booked
    ];
    assert.deepEqual(show(freeSlots(busy, monday8)), ['26 15:00-16:00', '28 9:00-10:00', '29 9:00-10:00']);
  });
  it('skips weekends and handles overlapping busy blocks', () => {
    const friday16 = new Date(2026, 9, 30, 13, 0); // Friday 1pm: lead time → 3pm
    const busy = [{ start: at(30, 15), end: at(30, 16) }, { start: at(30, 15, 30), end: at(30, 17) }];
    assert.deepEqual(show(freeSlots(busy, friday16)).slice(0, 1), ['2 9:00-10:00']); // Monday Nov 2
  });
  it('detects requests to find a time', () => {
    assert.ok(asksForTime('Are you free to meet next week?'));
    assert.ok(asksForTime('What times work for a quick call?'));
    assert.ok(asksForTime("Let me know your availability"));
    assert.ok(!asksForTime('Here is the invoice for October.'));
  });
});
