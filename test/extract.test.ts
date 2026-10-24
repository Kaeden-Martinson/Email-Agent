import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAmounts, findDates, mentionsDatesOrMoney, verifyItem, worthTracking } from '../src/main/core/extract';

// Email received Thursday 22 October 2026.
const BASE = new Date(2026, 9, 22, 10, 0);
const ymd = (at: number) => {
  const d = new Date(at);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

describe('findAmounts', () => {
  it('reads common money formats', () => {
    assert.deepEqual(findAmounts('Your balance of $1,234.56 is due.').map((m) => [m.amount, m.currency]), [[1234.56, 'USD']]);
    assert.deepEqual(findAmounts('A payment of $90.00 USD was approved').map((m) => m.amount), [90]);
    assert.deepEqual(findAmounts('Total: 45.00 EUR').map((m) => [m.amount, m.currency]), [[45, 'EUR']]);
    assert.deepEqual(findAmounts('£12 fee').map((m) => m.currency), ['GBP']);
  });
  it('ignores plain numbers', () => {
    assert.deepEqual(findAmounts('Order 12345 has 3 items, call 555-1234'), []);
  });
});

describe('findDates', () => {
  it('reads month names, with and without a year', () => {
    assert.deepEqual(ymd(findDates('Payment due Nov 14', BASE)[0].at), [2026, 11, 14]);
    assert.deepEqual(ymd(findDates('on November 14th, 2027', BASE)[0].at), [2027, 11, 14]);
    assert.deepEqual(ymd(findDates('due 14 November', BASE)[0].at), [2026, 11, 14]);
  });
  it('infers the nearest sensible year', () => {
    assert.deepEqual(ymd(findDates('due Jan 5', BASE)[0].at), [2027, 1, 5]);
    assert.deepEqual(ymd(findDates('since Oct 1', BASE)[0].at), [2026, 10, 1]);
  });
  it('reads ISO and numeric dates and flags ambiguous ones', () => {
    assert.deepEqual(ymd(findDates('2026-12-01', BASE)[0].at), [2026, 12, 1]);
    const amb = findDates('due 11/03/2026', BASE)[0];
    assert.deepEqual(ymd(amb.at), [2026, 11, 3]);
    assert.match(amb.ambiguous!, /US month\/day/);
    assert.equal(findDates('due 25/12/2026', BASE)[0].ambiguous, undefined);
    assert.deepEqual(ymd(findDates('due 25/12/2026', BASE)[0].at), [2026, 12, 25]);
  });
  it('reads times and converts stated time zones', () => {
    const local = findDates('Nov 3 at 2:30 PM', BASE)[0];
    assert.equal(local.allDay, false);
    assert.equal(new Date(local.at).getHours(), 14);
    const et = findDates('Interview Nov 3 at 10:00 AM ET', BASE)[0];
    assert.equal(et.tz, 'ET');
    assert.equal(new Date(et.at).getUTCHours(), 15);
  });
  it('rejects impossible dates', () => {
    assert.deepEqual(findDates('Feb 31', BASE), []);
  });
});

const email = 'Hi Kaeden, your statement is ready. A minimum payment of $35.00 is due Nov 14. Thanks, Chase';

describe('guards', () => {
  it('only asks the model for items when the email mentions dates, money or deadlines', () => {
    assert.ok(mentionsDatesOrMoney('Your bill of $20 is ready', BASE));
    assert.ok(mentionsDatesOrMoney('See you Nov 3', BASE));
    assert.ok(mentionsDatesOrMoney('The form is due tomorrow', BASE));
    assert.equal(mentionsDatesOrMoney('Thanks for the chat, talk soon!', BASE), false);
  });
  it('drops receipts and undated non-bills', () => {
    assert.equal(worthTracking({ kind: 'delivery', amount: 90 }), false);
    assert.equal(worthTracking({ kind: 'other' }), false);
    assert.ok(worthTracking({ kind: 'bill', amount: 35 }));
    assert.ok(worthTracking({ kind: 'event', at: 1 }));
  });
});

describe('verifyItem', () => {
  it('marks facts found word for word as explicit and high confidence', () => {
    const v = verifyItem(
      { kind: 'bill', title: 'Chase payment', date: '2026-11-14', amount: 35, evidence: 'A minimum payment of $35.00 is due Nov 14.' },
      email,
      BASE,
    )!;
    assert.equal(v.explicit, true);
    assert.equal(v.confidence, 'high');
    assert.equal(v.amount, 35);
    assert.deepEqual(ymd(v.at!), [2026, 11, 14]);
  });
  it('trusts the email over the model when they disagree', () => {
    const v = verifyItem(
      { kind: 'bill', title: 'Chase payment', date: '2026-11-15', amount: 53, evidence: 'A minimum payment of $35.00 is due Nov 14.' },
      email,
      BASE,
    )!;
    assert.deepEqual(ymd(v.at!), [2026, 11, 14]);
    assert.equal(v.amount, 35);
    assert.equal(v.confidence, 'medium');
    assert.ok(v.notes.some((n) => /date/.test(n)) && v.notes.some((n) => /amount/.test(n)));
  });
  it('never keeps an amount the email does not contain', () => {
    const v = verifyItem({ kind: 'bill', title: 'Bill', date: '2026-11-14', amount: 999, evidence: 'due Nov 14' }, email, BASE)!;
    assert.equal(v.amount, undefined);
    assert.ok(v.notes.some((n) => /does not contain/.test(n)));
  });
  it('marks quotes that are not in the email as AI inferred and low confidence', () => {
    const v = verifyItem({ kind: 'deadline', title: 'Something', date: '2026-11-20', evidence: 'Please respond by November 20' }, email, BASE)!;
    assert.equal(v.confidence, 'low');
    assert.equal(v.explicit, false);
  });
  it('flags several amounts in one sentence', () => {
    const text = 'Your balance is $120.00 and the minimum payment of $35.00 is due Nov 14.';
    const v = verifyItem({ kind: 'bill', title: 'Card', amount: 35, evidence: text }, text, BASE)!;
    assert.equal(v.amount, 35);
    assert.ok(v.notes.some((n) => /several amounts/.test(n)));
  });
  it('drops items without a title', () => {
    assert.equal(verifyItem({ kind: 'other', title: '  ' }, email, BASE), undefined);
  });
});
