import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cluster, similarKey } from '../src/shared/group';
import { suggestFromSignals, type Signal } from '../src/main/core/rules';

const now = Date.now();
const sig = (sender: string, kind: Signal['kind'], priority = 2, daysAgo = 1): Signal => ({ sender, kind, priority, at: now - daysAgo * 86_400_000 });

describe('suggestFromSignals', () => {
  it('suggests low priority after three dismissals with no replies', () => {
    const s = suggestFromSignals([sig('a@x.com', 'archived'), sig('a@x.com', 'dismissed'), sig('a@x.com', 'archived', 1)], []);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0].effect, { priority: 3 });
  });
  it('does not suggest from fewer signals, mixed behavior, or already-low mail', () => {
    assert.deepEqual(suggestFromSignals([sig('a@x.com', 'archived'), sig('a@x.com', 'archived')], []), []);
    assert.deepEqual(suggestFromSignals([sig('a@x.com', 'archived'), sig('a@x.com', 'archived'), sig('a@x.com', 'archived'), sig('a@x.com', 'replied')], []), []);
    assert.deepEqual(suggestFromSignals([sig('n@x.com', 'archived', 3), sig('n@x.com', 'archived', 3), sig('n@x.com', 'archived', 3)], []), []);
  });
  it('suggests important after three replies to non-urgent mail', () => {
    const s = suggestFromSignals([sig('b@y.com', 'replied'), sig('b@y.com', 'replied', 3), sig('b@y.com', 'replied')], []);
    assert.deepEqual(s[0].effect, { priority: 1 });
  });
  it('ignores old signals and senders that already have a rule', () => {
    assert.deepEqual(suggestFromSignals([1, 2, 3].map(() => sig('a@x.com', 'archived', 2, 90)), []), []);
    const rule = { id: 'r', enabled: true, createdAt: 0, match: { sender: 'a@x.com' }, effect: {}, origin: 'manual' as const, hits: 0 };
    assert.deepEqual(suggestFromSignals([1, 2, 3].map(() => sig('a@x.com', 'archived')), [rule]), []);
  });
});

describe('grouping similar emails', () => {
  it('ignores codes, numbers and reply prefixes in subjects', () => {
    assert.equal(similarKey('no-reply@accounts.google.com', 'Security alert'), similarKey('alerts@accounts.google.com', 'RE: Security alert'));
    assert.equal(similarKey('a@shop.com', 'Order #12345 shipped'), similarKey('b@shop.com', 'Order #99887 shipped'));
    assert.notEqual(similarKey('a@shop.com', 'Order shipped'), similarKey('a@other.com', 'Order shipped'));
  });
  it('clusters repeats within the window and keeps others separate', () => {
    const day = 86_400_000;
    const items = [
      { key: '1', from: 'no-reply@accounts.google.com', subject: 'Security alert', at: now },
      { key: '2', from: 'no-reply@accounts.google.com', subject: 'Security alert', at: now - day },
      { key: '3', from: 'dana@studio.io', subject: 'Q3 deck', at: now - 2 * day },
      { key: '4', from: 'no-reply@accounts.google.com', subject: 'Security alert', at: now - 30 * day },
    ];
    assert.deepEqual(cluster(items).map((c) => c.map((i) => i.key)), [['1', '2'], ['3'], ['4']]);
  });
  it('never merges emails whose subject is only numbers or symbols', () => {
    const items = [
      { key: '1', from: 'a@x.com', subject: '12345', at: now },
      { key: '2', from: 'a@x.com', subject: '67890', at: now - 1000 },
    ];
    assert.equal(cluster(items).length, 2);
  });
});
