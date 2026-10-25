import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digestSummary, weeklyDigest } from '../src/main/core/digest';
import type { ActivityEntry, KeyItem, Triage, Update } from '../src/shared/types';
import { message } from './fixtures';

const DAY = 86_400_000;
const now = Date.now();
const upd = (daysAgo: number, t: Partial<Triage>, from = 'Shop'): Update => ({
  key: String(Math.random()),
  status: 'new',
  message: message({ receivedAt: now - daysAgo * DAY, from: { name: from, email: 'x@y.z' } }),
  triage: { category: 'fyi', priority: 2, summary: '', actionItems: [], needsReply: false, draftReply: '', model: 'x', ...t } as Triage,
});
const act = (daysAgo: number, action: ActivityEntry['action'], trigger: ActivityEntry['trigger'], status: ActivityEntry['status'] = 'done') =>
  ({ id: String(Math.random()), at: now - daysAgo * DAY, accountId: 'a', action, trigger, status, reason: '', undoable: false }) as ActivityEntry;
const item = (inDays: number, kind: KeyItem['kind'], amount?: number, currency = 'USD') =>
  ({ id: String(Math.random()), accountId: 'a', key: 'k', sender: '', subject: '', kind, title: '', at: now + inDays * DAY, allDay: true, amount, currency, evidence: '', explicit: true, confidence: 'high', notes: [], sourceKeys: [], status: 'open', createdAt: now }) as unknown as KeyItem;

describe('weekly digest', () => {
  it('counts last week and the next two weeks', () => {
    const w = weeklyDigest({
      updates: [upd(1, { priority: 1 }), upd(2, {}), upd(10, {}), ...[1, 2, 3].map((d) => upd(d, { category: 'promo' }, 'MegaStore'))],
      activity: [act(1, 'archive', 'auto'), act(2, 'send', 'user'), act(3, 'label', 'auto', 'failed'), act(9, 'archive', 'auto')],
      items: [item(3, 'bill', 40), item(5, 'bill', 10.5), item(4, 'deadline'), item(30, 'bill', 99)],
      followUps: [],
      owed: 2,
    }, now);
    assert.equal(w.received, 5);
    assert.equal(w.important, 1);
    assert.equal(w.autoActions, 1);
    assert.equal(w.repliesSent, 1);
    assert.equal(w.bills, 2);
    assert.equal(w.billTotal, 50.5);
    assert.equal(w.deadlines, 1);
    assert.deepEqual(w.noisiest, [{ name: 'MegaStore', count: 3 }]);
    assert.match(digestSummary(w), /5 emails last week \(1 important\).*2 bills and 1 deadline.*2 replies you owe/);
  });
  it('does not add up different currencies', () => {
    const w = weeklyDigest({ updates: [], activity: [], items: [item(2, 'bill', 10, 'USD'), item(3, 'bill', 10, 'EUR')], followUps: [], owed: 0 }, now);
    assert.equal(w.billTotal, undefined);
    assert.equal(w.bills, 2);
  });
});
