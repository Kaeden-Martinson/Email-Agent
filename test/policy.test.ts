import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoUnsubscribeEligible,
  composeReply,
  decideAutoReply,
  replyBlocker,
  senderTrusted,
  shouldAutoArchive,
} from '../src/main/core/policy';
import { account, update } from './fixtures';

const opts = { categories: ['reply'], repliedThreads: [] as string[], sentLast24h: 0, dailySendCap: 10 };

describe('replyBlocker (hard rules)', () => {
  it('allows a normal personal email', () => {
    assert.equal(replyBlocker(update(), account(), []), undefined);
  });
  it('blocks mailing-list mail', () => {
    assert.match(replyBlocker(update({ isBulk: true }), account(), [])!, /bulk/i);
  });
  it('blocks no-reply senders, including look-alikes', () => {
    for (const email of ['no-reply@x.com', 'noreply@x.com', 'donotreply@x.com', 'notifications@x.com', 'mailer-daemon@x.com']) {
      assert.ok(replyBlocker(update({ from: { name: '', email } }), account(), []), email);
    }
  });
  it('blocks mail from yourself', () => {
    assert.match(replyBlocker(update({ from: { name: '', email: 'ME@example.com' } }), account(), [])!, /you/i);
  });
  it('uses Reply-To over From when deciding', () => {
    const u = update({ replyTo: { name: '', email: 'no-reply@x.com' } });
    assert.ok(replyBlocker(u, account(), []));
  });
  it('blocks never-reply categories even if the model says a reply is needed', () => {
    for (const category of ['newsletter', 'promo', 'notification', 'spam'] as const) {
      assert.ok(replyBlocker(update({}, { category }), account(), []), category);
    }
  });
  it('blocks a second reply in the same thread', () => {
    assert.match(replyBlocker(update(), account(), ['acc1:t1'])!, /already/i);
  });
});

describe('senderTrusted', () => {
  it('matches exact addresses case-insensitively', () => {
    assert.ok(senderTrusted('Boss@Company.com', ['boss@company.com']));
  });
  it('matches @domain exactly', () => {
    assert.ok(senderTrusted('anyone@company.com', ['@company.com']));
  });
  it('does not match look-alike or sub-domains', () => {
    assert.equal(senderTrusted('x@evilcompany.com', ['@company.com']), false);
    assert.equal(senderTrusted('x@company.com.evil.io', ['@company.com']), false);
    assert.equal(senderTrusted('x@sub.company.com', ['@company.com']), false);
  });
  it('does not treat a bare domain as a wildcard', () => {
    assert.equal(senderTrusted('x@company.com', ['company.com']), false);
  });
  it('ignores blank entries', () => {
    assert.equal(senderTrusted('x@company.com', ['', '  ']), false);
  });
});

describe('decideAutoReply', () => {
  it('does nothing when replies are off (the default)', () => {
    assert.deepEqual(decideAutoReply(update(), account(), opts), { kind: 'none' });
  });
  it('drafts but never sends in draft mode', () => {
    assert.deepEqual(decideAutoReply(update(), account({ replies: 'draft' }), opts), { kind: 'reply', send: false });
  });
  it('sends only to trusted senders in send mode', () => {
    const acc = account({ replies: 'send', trustedSenders: ['dana@studio.io'] });
    assert.deepEqual(decideAutoReply(update(), acc, opts), { kind: 'reply', send: true });
  });
  it('downgrades to a draft for untrusted senders in send mode', () => {
    const d = decideAutoReply(update(), account({ replies: 'send', trustedSenders: ['@other.com'] }), opts);
    assert.equal(d.kind, 'reply');
    assert.equal(d.kind === 'reply' && d.send, false);
  });
  it('downgrades to a draft once the daily cap is reached', () => {
    const acc = account({ replies: 'send', trustedSenders: ['dana@studio.io'] });
    const d = decideAutoReply(update(), acc, { ...opts, sentLast24h: 10 });
    assert.equal(d.kind === 'reply' && d.send, false);
  });
  it('skips categories the user did not allow', () => {
    assert.deepEqual(decideAutoReply(update({}, { category: 'action' }), account({ replies: 'draft' }), opts), { kind: 'none' });
  });
  it('never replies twice to the same email', () => {
    const u = { ...update(), reply: { state: 'drafted' as const, text: 'x', at: 0, auto: true } };
    assert.deepEqual(decideAutoReply(u, account({ replies: 'draft' }), opts), { kind: 'none' });
  });
  it('reports why it skipped bulk mail', () => {
    const d = decideAutoReply(update({ isBulk: true }), account({ replies: 'send', trustedSenders: ['dana@studio.io'] }), opts);
    assert.equal(d.kind, 'skip');
  });
});

describe('shouldAutoArchive', () => {
  const acc = account({ autoClean: ['promo', 'newsletter'] });
  it('archives an allowed category', () => {
    assert.ok(shouldAutoArchive(update({}, { category: 'promo', priority: 3, needsReply: false }), acc));
  });
  it('never archives priority 1', () => {
    assert.equal(shouldAutoArchive(update({}, { category: 'promo', priority: 1, needsReply: false }), acc), false);
  });
  it('never archives mail that needs a reply', () => {
    assert.equal(shouldAutoArchive(update({}, { category: 'newsletter', priority: 3, needsReply: true }), acc), false);
  });
  it('requires the archive permission', () => {
    const noManage = account({ autoClean: ['promo'], manage: false });
    assert.equal(shouldAutoArchive(update({}, { category: 'promo', priority: 3, needsReply: false }), noManage), false);
  });
  it('ignores categories not chosen', () => {
    assert.equal(shouldAutoArchive(update({}, { category: 'notification', priority: 3, needsReply: false }), acc), false);
  });
});

describe('autoUnsubscribeEligible', () => {
  const base = { accountId: 'acc1', sender: 's@x.com', name: 'S', count: 3, lastAt: 0 };
  it('requires one-click', () => {
    assert.equal(autoUnsubscribeEligible({ ...base, unsubscribe: { url: 'https://x.com/u', oneClick: false } }), false);
    assert.equal(autoUnsubscribeEligible({ ...base, unsubscribe: { mailto: 'mailto:u@x.com', oneClick: false } }), false);
    assert.ok(autoUnsubscribeEligible({ ...base, unsubscribe: { url: 'https://x.com/u', oneClick: true } }));
  });
  it('requires repeat mail from the sender', () => {
    assert.equal(autoUnsubscribeEligible({ ...base, count: 2, unsubscribe: { url: 'https://x.com/u', oneClick: true } }), false);
  });
  it('does not unsubscribe twice', () => {
    assert.equal(autoUnsubscribeEligible({ ...base, unsubscribedAt: 1, unsubscribe: { url: 'https://x.com/u', oneClick: true } }), false);
  });
});

describe('composeReply', () => {
  it('discloses only on auto-sent mail', () => {
    assert.match(composeReply('Hi', '', true, true), /Sent automatically/);
    assert.doesNotMatch(composeReply('Hi', '', false, true), /Sent automatically/);
    assert.doesNotMatch(composeReply('Hi', '', true, false), /Sent automatically/);
  });
  it('appends the signature', () => {
    assert.equal(composeReply(' Hi ', 'Kaeden', false, true), 'Hi\n\nKaeden');
  });
});
