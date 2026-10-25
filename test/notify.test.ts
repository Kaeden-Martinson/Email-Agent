import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatNote, inQuietHours, summarizeHeld, type NoteInput } from '../src/main/core/notify';

const urgent: NoteInput = {
  event: 'urgent',
  key: 'urgent:1',
  sender: 'Chase',
  subject: 'Payment of $84.50 overdue',
  detail: 'Your card payment of $84.50 is overdue; pay by Friday.',
};

describe('formatNote privacy levels', () => {
  it('minimal reveals nothing about the email', () => {
    const f = formatNote(urgent, 'minimal');
    const all = `${f.title} ${f.body}`;
    for (const secret of ['Chase', 'Payment', '84.50', 'overdue', 'Friday']) assert.ok(!all.includes(secret), secret);
    assert.match(f.body, /important new email/);
  });
  it('sender shows who and the subject but not the summary', () => {
    const f = formatNote(urgent, 'sender');
    assert.match(f.body, /Chase/);
    assert.match(f.body, /Payment of \$84\.50 overdue/);
    assert.ok(!f.body.includes('pay by Friday'));
  });
  it('full adds the summary', () => {
    assert.match(formatNote(urgent, 'full').body, /pay by Friday/);
  });
  it('briefings show only counts below full, and the written briefing at full', () => {
    const b: NoteInput = { event: 'briefing', key: 'b', safe: '2 need you · 1 bill due', detail: 'Priya needs your sign-off on the Acme contract.' };
    assert.equal(formatNote(b, 'minimal').body, '2 need you · 1 bill due');
    assert.equal(formatNote(b, 'sender').body, '2 need you · 1 bill due');
    assert.match(formatNote(b, 'full').body, /Acme contract/);
  });
  it('briefing and approval counts never include email details below full', () => {
    const a = formatNote({ event: 'approval', key: 'a', count: 3, subject: 'secret' }, 'sender');
    assert.equal(a.body, '3 actions are waiting for your approval.');
  });
});

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 22, h, m);
  it('handles ranges across midnight', () => {
    assert.ok(inQuietHours(at(23), '22:00', '07:00'));
    assert.ok(inQuietHours(at(6, 59), '22:00', '07:00'));
    assert.equal(inQuietHours(at(7), '22:00', '07:00'), false);
    assert.equal(inQuietHours(at(12), '22:00', '07:00'), false);
  });
  it('handles same-day ranges and empty ranges', () => {
    assert.ok(inQuietHours(at(13), '12:00', '14:00'));
    assert.equal(inQuietHours(at(15), '12:00', '14:00'), false);
    assert.equal(inQuietHours(at(15), '09:00', '09:00'), false);
  });
});

describe('summarizeHeld', () => {
  it('folds held notifications into one count-only message', () => {
    const s = summarizeHeld([urgent, { ...urgent, key: 'urgent:2' }, { event: 'reminder', key: 'r' }])!;
    assert.equal(s.body, '2 important emails, 1 reminder. Open Lodestar for details.');
    assert.ok(!s.body.includes('Chase'));
  });
  it('returns nothing when nothing is held', () => {
    assert.equal(summarizeHeld([]), undefined);
  });
});
