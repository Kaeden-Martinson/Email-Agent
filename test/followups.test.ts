import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectsReply, extractCommitments, followUpDue, isPersonalRecipient, replyArrived } from '../src/main/core/followups';
import { message } from './fixtures';

const THU = new Date(2026, 9, 22, 10, 30).getTime();

describe('expectsReply', () => {
  it('spots direct questions and requests', () => {
    assert.equal(expectsReply('Hi Dana,\nCan you send the signed contract?\nThanks'), 'Can you send the signed contract?');
    assert.match(expectsReply('Attached is the draft. Let me know what you think.')!, /Let me know/);
    assert.match(expectsReply('Please confirm the start date when you can.')!, /Please confirm/);
  });
  it('ignores plain acknowledgements', () => {
    for (const t of ['Thanks!', 'Thank you', 'Sounds good.', 'Got it, thanks!', 'Hi Dana,\n\nThanks!']) {
      assert.equal(expectsReply(t), undefined, t);
    }
  });
  it('ignores questions that only appear in the quoted history', () => {
    const t = 'Done, attached.\n\nOn Mon, Oct 20, 2026 at 3:12 PM Dana <dana@x.com> wrote:\n> Can you send it?';
    assert.equal(expectsReply(t), undefined);
  });
});

describe('extractCommitments', () => {
  it('finds promises and their deadlines', () => {
    const c = extractCommitments('Happy to help. I will send the final deck by Friday. Talk soon.', THU);
    assert.equal(c.length, 1);
    assert.match(c[0].text, /send the final deck/);
    assert.equal(new Date(c[0].dueAt!).getDate(), 23);
  });
  it('keeps promises without a date', () => {
    const c = extractCommitments("I'll look into the invoice issue.", THU);
    assert.equal(c.length, 1);
    assert.equal(c[0].dueAt, undefined);
  });
  it('ignores availability statements and questions', () => {
    assert.deepEqual(extractCommitments("I'll be out of office Monday. Will you send it?", THU), []);
  });
  it('ignores promises in the quoted history', () => {
    assert.deepEqual(extractCommitments('Thanks!\n\nOn Mon, Oct 20, 2026 at 3:12 PM Me <me@x.com> wrote:\n> I will send it Friday.', THU), []);
  });
});

describe('replyArrived', () => {
  const me = 'me@example.com';
  const msgs = [
    message({ id: 'a', receivedAt: 1, from: { name: '', email: me } }),
    message({ id: 'b', receivedAt: 2, from: { name: '', email: 'dana@studio.io' } }),
    message({ id: 'c', receivedAt: 3, from: { name: '', email: me } }),
  ];
  it('finds the first reply from the other side after a time', () => {
    assert.equal(replyArrived(msgs, 1, false, me)?.id, 'b');
    assert.equal(replyArrived(msgs, 2, false, me), undefined);
  });
  it('finds your own later reply', () => {
    assert.equal(replyArrived(msgs, 2, true, me)?.id, 'c');
  });
});

describe('followUpDue', () => {
  it('uses a stated deadline', () => {
    const r = followUpDue('Could you confirm by Friday?', THU, 3);
    assert.equal(new Date(r.at).getDate(), 23);
    assert.match(r.reason, /deadline/);
  });
  it('otherwise skips weekends when counting working days', () => {
    const r = followUpDue('Can you take a look?', THU, 3); // Thu + 3 working days = Tue
    assert.equal(new Date(r.at).getDay(), 2);
    assert.equal(new Date(r.at).getDate(), 27);
  });
});

describe('isPersonalRecipient', () => {
  it('excludes automated and role addresses', () => {
    assert.ok(isPersonalRecipient('dana@studio.io'));
    for (const e of ['no-reply@x.com', 'support@x.com', 'notifications@x.com', '']) assert.equal(isPersonalRecipient(e), false, e);
  });
});
