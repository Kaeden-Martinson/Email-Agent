import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTriage } from '../src/main/ai/triage';
import { prefilter, processingRank } from '../src/main/core/prefilter';
import { applyRule, correctOnce, domainRuleAllowed, matchRule, ruleSkipsModel, suggestRules } from '../src/main/core/rules';
import type { Correction, Rule } from '../src/shared/types';
import { message } from './fixtures';

const bulk = (subject: string, body = 'Read more on our site.') =>
  message({ isBulk: true, subject, snippet: subject, body, from: { name: 'Shop', email: 'news@shop.example' } });

describe('prefilter', () => {
  it('classifies plain newsletters without the model', () => {
    const r = prefilter(bulk('Ilhan Omar’s Worst Answer Yet', 'This week in politics...'));
    assert.equal(r.route, 'fast');
    assert.equal(r.route === 'fast' && r.triage.category, 'newsletter');
    assert.equal(r.route === 'fast' && r.triage.priority, 3);
  });
  it('spots promotions', () => {
    const r = prefilter(bulk('One Day Only: Take 50% off'));
    assert.equal(r.route === 'fast' && r.triage.category, 'promo');
  });
  it('sends bulk mail about accounts, money or school to the model', () => {
    for (const subject of ['Your Tennessee Tech admissions counselor', 'Security alert', 'Your invoice is ready', 'Payment failed', 'Application deadline Friday']) {
      assert.equal(prefilter(bulk(subject)).route, 'light', subject);
    }
  });
  it('ignores deadline words in promotional fine print', () => {
    const r = prefilter(bulk('Your Invite Still Stands', 'Take 50% off today. Offer expires 7 days after receipt or use.'));
    assert.equal(r.route === 'fast' && r.triage.category, 'promo');
  });
  it('still reads a bill that mentions a discount', () => {
    assert.equal(prefilter(bulk('Your bill is ready', 'Save $10 with autopay. Amount due on Nov 3.')).route, 'light');
  });
  it('gives personal mail a full read', () => {
    assert.equal(prefilter(message()).route, 'full');
  });
  it('gives automated non-bulk senders a light read', () => {
    assert.equal(prefilter(message({ from: { name: 'Google', email: 'no-reply@accounts.google.com' } })).route, 'light');
  });
  it('processes rule-decided mail first, then unread personal mail', () => {
    const ranks = [
      processingRank(bulk('Weekly news')),
      processingRank(message({ unread: true })),
      processingRank(message({ unread: false })),
    ];
    assert.deepEqual(ranks, [0, 1, 2]);
  });
});

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r1',
  enabled: true,
  createdAt: 0,
  match: {},
  effect: {},
  origin: 'manual',
  hits: 0,
  ...over,
});

describe('rules', () => {
  const m = message({ from: { name: 'J', email: 'jsilverman@tntech.edu' } });
  it('prefers an exact sender rule over a domain rule', () => {
    const rules = [rule({ id: 'd', match: { domain: 'tntech.edu' }, effect: { priority: 3 } }), rule({ id: 's', match: { sender: 'jsilverman@tntech.edu' }, effect: { priority: 1 } })];
    assert.equal(matchRule(m, rules)?.id, 's');
  });
  it('ignores disabled rules', () => {
    assert.equal(matchRule(m, [rule({ enabled: false, match: { sender: 'jsilverman@tntech.edu' } })]), undefined);
  });
  it('does not match other domains that merely contain the domain', () => {
    const other = message({ from: { name: '', email: 'x@nottntech.edu' } });
    assert.equal(matchRule(other, [rule({ match: { domain: 'tntech.edu' } })]), undefined);
  });
  it('overrides the AI and explains itself', () => {
    const out = applyRule({ category: 'newsletter', priority: 3, reason: 'AI', needsReply: false }, rule({ match: { sender: 'a@b.c' }, effect: { priority: 1 } }));
    assert.equal(out.priority, 1);
    assert.equal(out.category, 'fyi');
    assert.match(out.reason!, /Your rule/);
  });
  it('refuses domain rules for shared webmail domains', () => {
    assert.equal(domainRuleAllowed('gmail.com'), false);
    assert.equal(domainRuleAllowed('outlook.com'), false);
    assert.equal(domainRuleAllowed('yahoo.co.uk'), false);
    assert.ok(domainRuleAllowed('tntech.edu'));
  });
  it('lets low-priority rules skip the model', () => {
    assert.ok(ruleSkipsModel(rule({ effect: { priority: 3 } })));
    assert.equal(ruleSkipsModel(rule({ effect: { priority: 1 } })), false);
  });
});

describe('corrections', () => {
  it('a single correction only changes that email', () => {
    assert.deepEqual(correctOnce({ category: 'newsletter', priority: 3 }, 'more'), { category: 'fyi', priority: 2 });
    assert.deepEqual(correctOnce({ category: 'action', priority: 1 }, 'less'), { category: 'action', priority: 2 });
    assert.deepEqual(correctOnce({ category: 'action', priority: 1 }, 'junk'), { category: 'action', priority: 3 });
  });
  it('keeps notification as the category when promoted', () => {
    assert.equal(correctOnce({ category: 'notification', priority: 2 }, 'more').category, 'notification');
  });
  const c = (sender: string, kind: Correction['kind']): Correction => ({
    at: 0, key: 'k', sender, kind, from: { category: 'fyi', priority: 2 }, to: { category: 'fyi', priority: 3 },
  });
  it('never suggests a rule from one correction', () => {
    assert.deepEqual(suggestRules([c('a@x.com', 'less')], []), []);
  });
  it('suggests a rule after two same-direction corrections', () => {
    const s = suggestRules([c('a@x.com', 'less'), c('a@x.com', 'junk')], []);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0].effect, { priority: 3 });
  });
  it('does not suggest on mixed signals or when a rule exists', () => {
    assert.deepEqual(suggestRules([c('a@x.com', 'less'), c('a@x.com', 'more')], []), []);
    assert.deepEqual(suggestRules([c('a@x.com', 'less'), c('a@x.com', 'less')], [rule({ match: { sender: 'a@x.com' } })]), []);
  });
});

describe('normalizeTriage (guard rails on model output)', () => {
  it('never lets bulk mail need a reply', () => {
    const t = normalizeTriage({ category: 'reply', priority: 1, needsReply: true, draftReply: 'hi' }, message({ isBulk: true }), 'm', 'full');
    assert.equal(t.needsReply, false);
    assert.equal(t.draftReply, '');
    assert.notEqual(t.category, 'reply');
  });
  it('caps junk categories at low priority', () => {
    for (const category of ['spam', 'promo', 'newsletter'] as const) {
      assert.equal(normalizeTriage({ category, priority: 1 }, message(), 'm', 'full').priority, 3);
    }
  });
  it('replaces unknown categories', () => {
    assert.equal(normalizeTriage({ category: 'urgent!!' as never }, message(), 'm', 'full').category, 'fyi');
  });
  it('light reads never produce drafts', () => {
    const t = normalizeTriage({ category: 'reply', needsReply: true, draftReply: 'x' }, message(), 'm', 'light');
    assert.equal(t.needsReply, false);
    assert.equal(t.source, 'light');
  });
});
