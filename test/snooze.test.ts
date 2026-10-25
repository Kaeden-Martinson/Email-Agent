import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snoozeTime } from '../src/main/core/when';

const sat = new Date(2026, 9, 24, 15, 0); // Saturday Oct 24 2026, 3pm
const ok = (r: ReturnType<typeof snoozeTime>) => {
  assert.ok(!('error' in r), JSON.stringify(r));
  return r as Exclude<typeof r, { error: string }>;
};

describe('snooze times', () => {
  it('tomorrow is 8am the next day', () => {
    assert.equal(ok(snoozeTime('tomorrow', sat)).at, new Date(2026, 9, 25, 8).getTime());
  });
  it('next week is the coming Monday at 8am, even on a Monday', () => {
    assert.equal(ok(snoozeTime('nextweek', sat)).at, new Date(2026, 9, 26, 8).getTime());
    assert.equal(ok(snoozeTime('nextweek', new Date(2026, 9, 26, 9))).at, new Date(2026, 10, 2, 8).getTime());
  });
  it('until they reply has a two-week fallback', () => {
    const r = ok(snoozeTime('reply', sat));
    assert.equal(r.untilReply, true);
    assert.equal(r.at, sat.getTime() + 14 * 86_400_000);
  });
  it('parses plain English and refuses nonsense', () => {
    const r = ok(snoozeTime('in 3 days', sat));
    assert.ok(r.at > sat.getTime());
    assert.ok(ok(snoozeTime("monday if they haven't replied", sat)).untilReply);
    assert.ok('error' in snoozeTime('purple elephant', sat));
  });
});
