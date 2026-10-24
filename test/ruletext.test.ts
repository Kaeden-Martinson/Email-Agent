import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeParsedRule } from '../src/main/ai/ruletext';
import { describeRule, matchRule, sameMatch } from '../src/main/core/rules';
import type { Rule } from '../src/shared/types';
import { message } from './fixtures';

const rule = (o: Partial<Rule>): Rule => ({ id: 'r', enabled: true, createdAt: 0, hits: 0, origin: 'manual', match: {}, effect: { priority: 1 }, ...o });

describe('rules with subject words', () => {
  const invoice = message({ subject: 'Your Invoice #123', from: { name: 'Acme', email: 'billing@acme.com' } });
  const promo = message({ subject: 'Big sale', from: { name: 'Acme', email: 'billing@acme.com' } });

  it('matches subject words case-insensitively, for any sender when no sender is given', () => {
    const r = rule({ match: { subjectContains: 'invoice' } });
    assert.equal(matchRule(invoice, [r])?.id, 'r');
    assert.equal(matchRule(promo, [r]), undefined);
  });
  it('requires both sender and subject when a rule has both', () => {
    const r = rule({ match: { domain: 'acme.com', subjectContains: 'invoice' } });
    assert.equal(matchRule(invoice, [r])?.id, 'r');
    assert.equal(matchRule(promo, [r]), undefined);
    assert.equal(matchRule(message({ subject: 'invoice', from: { name: '', email: 'x@other.com' } }), [r]), undefined);
  });
  it('prefers the more specific rule', () => {
    const rules = [
      rule({ id: 'subject', match: { subjectContains: 'invoice' } }),
      rule({ id: 'domain', match: { domain: 'acme.com' } }),
      rule({ id: 'domain+subject', match: { domain: 'acme.com', subjectContains: 'invoice' } }),
    ];
    assert.equal(matchRule(invoice, rules)?.id, 'domain+subject');
    assert.equal(matchRule(promo, rules)?.id, 'domain');
    assert.equal(matchRule(message({ subject: 'invoice due', from: { name: '', email: 'a@b.org' } }), rules)?.id, 'subject');
  });
  it('treats rules with the same match as the same rule', () => {
    assert.ok(sameMatch({ domain: 'Acme.com', subjectContains: 'Invoice' }, { domain: 'acme.com', subjectContains: 'invoice' }));
    assert.ok(!sameMatch({ domain: 'acme.com' }, { domain: 'acme.com', subjectContains: 'invoice' }));
  });
  it('describes subject rules in plain words', () => {
    assert.match(describeRule(rule({ match: { subjectContains: 'webinar' }, effect: { priority: 3, hide: true } })), /anyone, subject contains "webinar": hide/);
  });
});

describe('plain-English rule parsing (model output checks)', () => {
  it('accepts what the sentence actually says', () => {
    const r = normalizeParsedRule({ sender: '', domain: 'acme.com', subjectContains: 'invoice', effect: 'important' }, 'Emails from acme.com about invoice are important');
    assert.deepEqual(r, { match: { domain: 'acme.com', subjectContains: 'invoice' }, effect: { priority: 1 } });
  });
  it('drops addresses and domains the user never typed', () => {
    const r = normalizeParsedRule({ sender: 'alerts@chase.com', domain: 'chase.com', subjectContains: '', effect: 'important' }, 'Mail from Chase is important');
    assert.ok('error' in r);
  });
  it('drops subject words that are not in the sentence but keeps the rest', () => {
    const r = normalizeParsedRule({ sender: 'boss@work.com', domain: 'work.com', subjectContains: 'urgent', effect: 'important' }, 'boss@work.com is always important');
    assert.deepEqual(r, { match: { sender: 'boss@work.com' }, effect: { priority: 1 } });
  });
  it('maps hide and low priority, and refuses unclear effects', () => {
    assert.deepEqual(normalizeParsedRule({ sender: '', domain: '', subjectContains: 'webinar', effect: 'hide' }, 'hide anything with "webinar"'), {
      match: { subjectContains: 'webinar' },
      effect: { priority: 3, hide: true },
    });
    assert.deepEqual((normalizeParsedRule({ domain: '@news.io', effect: 'low' }, 'news.io is low priority') as { effect: unknown }).effect, { priority: 3 });
    assert.ok('error' in normalizeParsedRule({ domain: 'news.io', effect: 'unclear' }, 'news.io'));
    assert.ok('error' in normalizeParsedRule({ domain: 'news.io', effect: 'delete' }, 'delete everything from news.io'));
  });
  it('ignores junk output', () => {
    assert.ok('error' in normalizeParsedRule(null, 'anything'));
    assert.ok('error' in normalizeParsedRule({ domain: 'not a domain', effect: 'important' }, 'not a domain is important'));
  });
});
