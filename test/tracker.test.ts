import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SETTINGS } from '../src/main/store';
import { itemDeadline, Tracker } from '../src/main/tracker';
import type { Reminder, Update } from '../src/shared/types';
import { account, message, triage } from './fixtures';

function setup() {
  const data = {
    accounts: [account()],
    updates: {} as Record<string, Update>,
    followUps: [],
    commitments: [],
    reminders: [] as Reminder[],
    items: [] as never[],
    owedCheckedAt: {},
  };
  const fired: Reminder[] = [];
  const t = new Tracker({
    store: { data } as never,
    settings: () => DEFAULT_SETTINGS,
    changed() {},
    onReminder: (r) => fired.push(r),
    onReply() {},
  });
  return { t, data, fired };
}

const bill = (key: string, receivedAt: number): Update => ({
  key,
  status: 'new',
  message: message({ id: key, receivedAt, from: { name: 'Chase', email: `no-reply${key}@alerts.chase.com` }, subject: 'Statement', body: 'A minimum payment of $35.00 is due Nov 14.' }),
  triage: triage({ category: 'notification', needsReply: false, keyItems: [{ kind: 'bill', title: 'Chase payment', date: '2026-11-14', amount: 35, evidence: 'A minimum payment of $35.00 is due Nov 14.' }] }),
});

describe('Tracker items', () => {
  it('files verified items and merges duplicates from the same sender domain', () => {
    const { t, data } = setup();
    const base = new Date(2026, 9, 22).getTime();
    t.ingestItems(bill('a', base));
    t.ingestItems(bill('b', base + 86_400_000));
    t.ingestItems(bill('a', base)); // re-read of the same email
    assert.equal(data.items.length, 1);
    const item = data.items[0] as unknown as { sourceKeys: string[]; key: string; amount: number; confidence: string };
    assert.deepEqual(item.sourceKeys, ['a', 'b']);
    assert.equal(item.key, 'b', 'points at the newest email');
    assert.equal(item.amount, 35);
    assert.equal(item.confidence, 'high');
  });
  it('drops receipts with no date', () => {
    const { t, data } = setup();
    const u = bill('c', Date.now());
    u.triage!.keyItems = [{ kind: 'delivery', title: 'Payment approved', amount: 90, evidence: 'Amount 90.00 USD' }];
    t.ingestItems(u);
    assert.equal(data.items.length, 0);
  });
  it('treats all-day items as due at the end of their day', () => {
    const d = new Date(2026, 10, 14).getTime();
    assert.equal(new Date(itemDeadline({ at: d, allDay: true })).getHours(), 23);
    assert.equal(itemDeadline({ at: d, allDay: false }), d);
  });
});

describe('Tracker owed replies and promises', () => {
  it('lists emails that need a reply and marks old ones overdue', () => {
    const { t, data } = setup();
    data.updates.x = { key: 'x', status: 'new', message: message({ receivedAt: Date.now() - 10 * 86_400_000 }), triage: triage() };
    data.updates.y = { key: 'y', status: 'new', message: message({ receivedAt: Date.now() }), triage: triage({ repliedAlready: true }) };
    const owed = t.owed();
    assert.deepEqual(owed.map((o) => o.key), ['x']);
    assert.equal(owed[0].overdue, true);
  });
  it('turns conversation promises into commitments once', () => {
    const { t, data } = setup();
    const u: Update = { key: 'p', status: 'new', message: message({ receivedAt: new Date(2026, 9, 22).getTime() }), triage: triage({ userPromises: ['Send the deck by Friday'] }) };
    t.noteConversationPromises(u);
    t.noteConversationPromises(u);
    assert.equal(data.commitments.length, 1);
    assert.equal(new Date((data.commitments[0] as { dueAt: number }).dueAt).getDate(), 23);
  });
});

describe('Tracker reminders', () => {
  it('parses plain English and fires when due', async () => {
    const { t, data, fired } = setup();
    data.updates.x = { key: 'x', status: 'new', message: message(), triage: triage() };
    t.remind({ kind: 'update', key: 'x' }, 'in 2 hours');
    assert.equal(data.reminders.length, 1);
    data.reminders[0].at = Date.now() - 1000;
    await t.tick();
    assert.equal(fired.length, 1);
    assert.equal(data.reminders[0].status, 'due');
  });
  it('skips an "unless replied" reminder when the reply already happened', async () => {
    const { t, data, fired } = setup();
    data.updates.x = { key: 'x', status: 'new', message: message(), triage: triage({ repliedAlready: true }) };
    data.reminders.push({ id: 'r', target: { kind: 'update', key: 'x' }, title: 't', phrase: 'Friday if no reply', at: Date.now() - 1, unlessReplied: true, createdAt: 0, status: 'pending' });
    await t.tick();
    assert.equal(fired.length, 0);
    assert.equal(data.reminders[0].status, 'resolved');
    assert.match(data.reminders[0].note!, /already replied/);
  });
  it('rejects phrases it cannot understand', () => {
    const { t, data } = setup();
    data.updates.x = { key: 'x', status: 'new', message: message(), triage: triage() };
    assert.throws(() => t.remind({ kind: 'update', key: 'x' }, 'whenever'), /couldn't find a time/);
  });
});
