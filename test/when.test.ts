import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deadlineIn, parseWhen } from '../src/main/core/when';

// Thursday 22 October 2026, 10:30 local time.
const NOW = new Date(2026, 9, 22, 10, 30);

function at(input: string, defaultHour?: number): Date {
  const r = parseWhen(input, NOW, defaultHour);
  if ('error' in r) throw new Error(r.error);
  return new Date(r.at);
}

const ymdh = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

describe('parseWhen', () => {
  it('weekdays mean the coming one, at 9am by default', () => {
    assert.deepEqual(ymdh(at('Friday')), [2026, 10, 23, 9, 0]);
    assert.deepEqual(ymdh(at('on Monday')), [2026, 10, 26, 9, 0]);
  });
  it('a weekday said on that weekday means next week', () => {
    assert.deepEqual(ymdh(at('Thursday')), [2026, 10, 29, 9, 0]);
  });
  it('"next Friday" is the Friday of next week', () => {
    assert.deepEqual(ymdh(at('next Friday')), [2026, 10, 30, 9, 0]);
  });
  it('relative days and times', () => {
    assert.deepEqual(ymdh(at('tomorrow')), [2026, 10, 23, 9, 0]);
    assert.deepEqual(ymdh(at('tomorrow at 3pm')), [2026, 10, 23, 15, 0]);
    assert.deepEqual(ymdh(at('in 3 days')), [2026, 10, 25, 9, 0]);
    assert.deepEqual(ymdh(at('in 2 hours')), [2026, 10, 22, 12, 30]);
    assert.deepEqual(ymdh(at('in a week')), [2026, 10, 29, 9, 0]);
  });
  it('a bare time means today if still ahead, otherwise tomorrow', () => {
    assert.deepEqual(ymdh(at('at 4pm')), [2026, 10, 22, 16, 0]);
    assert.deepEqual(ymdh(at('at 9am')), [2026, 10, 23, 9, 0]);
    assert.deepEqual(ymdh(at('at 3')), [2026, 10, 22, 15, 0]);
  });
  it('named periods', () => {
    assert.deepEqual(ymdh(at('next week')), [2026, 10, 26, 9, 0]);
    assert.deepEqual(ymdh(at('this weekend')), [2026, 10, 24, 9, 0]);
    assert.deepEqual(ymdh(at('end of week')), [2026, 10, 23, 17, 0]);
    assert.deepEqual(ymdh(at('tonight')), [2026, 10, 22, 19, 0]);
  });
  it('calendar dates, rolling into next year when already past', () => {
    assert.deepEqual(ymdh(at('Nov 3')), [2026, 11, 3, 9, 0]);
    assert.deepEqual(ymdh(at('3rd of November at 2:30pm')), [2026, 11, 3, 14, 30]);
    assert.deepEqual(ymdh(at('11/3')), [2026, 11, 3, 9, 0]);
    assert.deepEqual(ymdh(at('Jan 5')), [2027, 1, 5, 9, 0]);
  });
  it('understands "if they haven\'t replied" in many phrasings', () => {
    for (const p of [
      "remind me Friday if they haven't responded",
      'Friday if no reply',
      "Friday if they haven't replied yet",
      'Friday unless they reply',
      'Friday if she hasn’t answered',
    ]) {
      const r = parseWhen(p, NOW);
      assert.ok('at' in r && r.unlessReplied, p);
      assert.deepEqual('at' in r && ymdh(new Date(r.at)), [2026, 10, 23, 9, 0], p);
    }
    const plain = parseWhen('Friday', NOW);
    assert.ok('at' in plain && !plain.unlessReplied);
  });
  it('rejects phrases with no time and times already past', () => {
    assert.ok('error' in parseWhen('whenever', NOW));
    assert.ok('error' in parseWhen('today at 8am', NOW));
  });
});

describe('deadlineIn', () => {
  it('finds "by <day>" and uses end of day', () => {
    assert.deepEqual(ymdh(new Date(deadlineIn('I will send the deck by Friday.', NOW)!)), [2026, 10, 23, 17, 0]);
    assert.deepEqual(ymdh(new Date(deadlineIn('Please reply before Nov 3, thanks', NOW)!)), [2026, 11, 3, 17, 0]);
  });
  it('returns undefined when there is no deadline', () => {
    assert.equal(deadlineIn('Thanks for the update!', NOW), undefined);
  });
});
