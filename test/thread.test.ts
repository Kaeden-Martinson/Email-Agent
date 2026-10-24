import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildThread, formatThread, MAX_THREAD_MESSAGES, stripQuoted } from '../src/main/core/thread';
import { message } from './fixtures';

describe('stripQuoted', () => {
  it('cuts Gmail "On … wrote:" history', () => {
    const t = 'Sounds good, Friday works.\n\nOn Mon, Oct 20, 2026 at 3:12 PM Dana Kim <dana@studio.io> wrote:\n> Can we meet Friday?\n> Thanks';
    assert.equal(stripQuoted(t), 'Sounds good, Friday works.');
  });
  it('handles the header wrapped onto two lines', () => {
    const t = 'Yes!\n\nOn Mon, Oct 20, 2026 at 3:12 PM Dana Kim <dana@studio.io>\nwrote:\n> old';
    assert.equal(stripQuoted(t), 'Yes!');
  });
  it('cuts Outlook From/Sent header blocks', () => {
    const t = 'Approved.\n\nFrom: Priya Shah <priya@acme.co>\nSent: Tuesday, October 21, 2026 9:00 AM\nTo: Me\nSubject: Contract';
    assert.equal(stripQuoted(t), 'Approved.');
  });
  it('cuts "Original Message" and underscore separators', () => {
    assert.equal(stripQuoted('Done.\n-----Original Message-----\nold'), 'Done.');
    assert.equal(stripQuoted('Done.\n________________________________\nold'), 'Done.');
  });
  it('drops interleaved "> " lines but keeps the replies between them', () => {
    assert.equal(stripQuoted('> Can you send it?\nSent it this morning.\n> And the invoice?\nAttached.'), 'Sent it this morning.\nAttached.');
  });
  it('keeps forwarded content', () => {
    const t = 'FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Bank\nYour statement is ready.';
    assert.match(stripQuoted(t), /Your statement is ready/);
  });
  it('falls back to the original when everything is quoted', () => {
    assert.equal(stripQuoted('> only quoted'), '> only quoted');
  });
  it('does not treat a sentence starting with "On" as a reply header', () => {
    assert.equal(stripQuoted('On Friday I can bring the slides.\nThanks'), 'On Friday I can bring the slides.\nThanks');
  });
});

describe('buildThread', () => {
  const me = 'me@example.com';
  const m = (id: string, at: number, email: string, body: string) =>
    message({ id, receivedAt: at, from: { name: email === me ? 'Me' : 'Dana', email }, body, messageIdHeader: `<${id}@x>` });

  it('orders oldest first, ends at the current message, and marks your messages', () => {
    const msgs = [m('b', 2, me, 'I will send the deck Friday.'), m('a', 1, 'dana@studio.io', 'Can you send the deck?'), m('c', 3, 'dana@studio.io', 'Any update?')];
    const v = buildThread(msgs, msgs[2], me);
    assert.deepEqual(v.thread.map((t) => t.id), ['a', 'b', 'c']);
    assert.deepEqual(v.thread.map((t) => t.fromMe), [false, true, false]);
    assert.equal(v.repliedAfter, false);
  });
  it('detects that you already replied after the current message', () => {
    const msgs = [m('a', 1, 'dana@studio.io', 'Can you send the deck?'), m('b', 2, me, 'Sent!')];
    const v = buildThread(msgs, msgs[0], me);
    assert.equal(v.repliedAfter, true);
    assert.deepEqual(v.thread.map((t) => t.id), ['a']);
  });
  it('adds the current message when the provider did not return it', () => {
    const cur = m('x', 5, 'dana@studio.io', 'Hello');
    assert.deepEqual(buildThread([], cur, me).thread.map((t) => t.id), ['x']);
  });
  it('keeps only the newest messages', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => m(`m${i}`, i, 'dana@studio.io', `msg ${i}`));
    const v = buildThread(msgs, msgs[11], me);
    assert.equal(v.thread.length, MAX_THREAD_MESSAGES);
    assert.equal(v.thread.at(-1)!.id, 'm11');
  });
  it('strips quoted history from each message', () => {
    const msgs = [m('a', 1, 'dana@studio.io', 'New text\n\nOn Mon, Oct 20, 2026 at 3:12 PM Me <me@example.com> wrote:\n> old')];
    assert.equal(buildThread(msgs, msgs[0], me).thread[0].text, 'New text');
  });
  it('numbers messages and labels yours for the model', () => {
    const msgs = [m('a', 1, 'dana@studio.io', 'Q?'), m('b', 2, me, 'A.')];
    const text = formatThread(buildThread(msgs, msgs[1], me).thread);
    assert.match(text, /^\[1\] .*dana@studio\.io/m);
    assert.match(text, /^\[2\] .*The user/m);
  });
});
