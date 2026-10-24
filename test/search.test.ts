import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIndex, cosine, fuse, keywordSearch, parseQuery, snippet, tokenize, type SearchDoc } from '../src/main/core/search';

const NOW = new Date(2026, 9, 22, 10, 0); // Thu 22 Oct 2026
const day = (n: number) => NOW.getTime() - n * 86_400_000;

const docs: SearchDoc[] = [
  { id: 'tt', at: day(1), from: 'Jessica Silverman jsilverman@tntech.edu', subject: 'Tennessee Tech is in Mt. Juliet Thursday', body: 'Admissions event in Wilson County. Meet your admissions counselor.' },
  { id: 'chase', at: day(3), from: 'Chase no-reply@alerts.chase.com', subject: 'Your statement is ready', body: 'Minimum payment of $35.00 is due Nov 14. Bill deadline.' },
  { id: 'lease', at: day(12), from: 'Rent Co landlord@rentco.example', subject: 'Lease renewal', body: 'Your lease renewal and the new rent amount for 2027. Refund of deposit available.' },
  { id: 'news', at: day(2), from: 'The Daily Wire', subject: 'Weekly news', body: 'Politics and culture this week. Tennessee mentioned once.' },
];
const index = buildIndex(docs);
const ids = (q: string) => keywordSearch(index, parseQuery(q, NOW)).map((h) => h.id);

describe('tokenize', () => {
  it('lowercases, drops stop words and stems plurals', () => {
    assert.deepEqual(tokenize("What are my upcoming Deadlines?"), ['upcom', 'deadline']);
    assert.deepEqual(tokenize("Tennessee Tech's admissions"), ['tennessee', 'tech', 'admission']);
  });
});

describe('parseQuery', () => {
  it('extracts explicit filters', () => {
    const q = parseQuery('from:chase subject:"statement" after:2026-10-01 payment', NOW);
    assert.equal(q.from, 'chase');
    assert.equal(q.subject, 'statement');
    assert.equal(new Date(q.after!).getDate(), 1);
    assert.deepEqual(q.terms, ['payment']);
  });
  it('understands relative time phrases', () => {
    assert.equal(parseQuery('refund last week', NOW).after, new Date(2026, 9, 15).getTime());
    const y = parseQuery('emails yesterday', NOW);
    assert.equal(y.after, new Date(2026, 9, 21).getTime());
    assert.equal(y.before, new Date(2026, 9, 22).getTime());
    assert.equal(parseQuery('in the last 3 days', NOW).after, new Date(2026, 9, 19).getTime());
  });
  it('reads natural-language senders', () => {
    assert.equal(parseQuery('What did Tennessee Tech say about admissions?', NOW).from, undefined);
    assert.equal(parseQuery('emails from Rent Co about the lease', NOW).from, 'rent co');
  });
});

describe('keywordSearch', () => {
  it('ranks the sender and subject match first', () => {
    assert.equal(ids('What did Tennessee Tech say about admissions?')[0], 'tt');
  });
  it('matches stemmed words in the body', () => {
    assert.equal(ids('find the email that mentioned a refund')[0], 'lease');
    assert.equal(ids('bills due')[0], 'chase');
  });
  it('applies filters', () => {
    assert.deepEqual(ids('lease last week'), []);
    assert.deepEqual(ids('from:chase'), ['chase']);
  });
  it('drops weak single-word matches when better ones exist', () => {
    const idx = buildIndex([
      { id: 'contract', at: 1, from: 'Priya', subject: 'Contract redlines', body: 'needs your sign-off on the contract' },
      { id: 'sale', at: 2, from: 'Shop', subject: 'Flash sale', body: '40% off everything' },
    ]);
    assert.deepEqual(keywordSearch(idx, parseQuery('contract sign-off', NOW)).map((h) => h.id), ['contract']);
  });
  it('returns nothing for unrelated words', () => {
    assert.deepEqual(ids('zebra quantum'), []);
  });
});

describe('fusion and vectors', () => {
  it('cosine similarity', () => {
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
  });
  it('fuses rankings, rewarding agreement', () => {
    assert.deepEqual(fuse([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]]).slice(0, 1), ['b']);
  });
});

describe('snippet', () => {
  it('centres on the first matching word', () => {
    const s = snippet(`${'x '.repeat(100)}the refund was approved`, ['refund']);
    assert.match(s, /^….*refund was approved$/);
  });
});
