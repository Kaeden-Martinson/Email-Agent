import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanAnswer, formatSources } from '../src/main/core/answer';

describe('cleanAnswer', () => {
  it('keeps real citations from the text and the list', () => {
    const a = cleanAnswer({ answer: 'The event is Oct 29 [2]. Bring ID [1].', found: true, citations: [2] }, 3);
    assert.deepEqual(a.citations, [1, 2]);
    assert.equal(a.verified, true);
  });
  it('removes markers that point at sources that do not exist', () => {
    const a = cleanAnswer({ answer: 'It is due Nov 14 [7].', found: true, citations: [7, 0] }, 3);
    assert.equal(a.answer, 'It is due Nov 14.');
    assert.deepEqual(a.citations, []);
    assert.equal(a.verified, false);
  });
  it('validates each number in multi-source markers', () => {
    const a = cleanAnswer({ answer: 'It is on Oct 29 [1, 7, 9].', found: true, citations: [] }, 7);
    assert.equal(a.answer, 'It is on Oct 29 [1, 7].');
    assert.deepEqual(a.citations, [1, 7]);
  });
  it('never treats "not found" as verified', () => {
    const a = cleanAnswer({ answer: "I couldn't find that.", found: false, citations: [1] }, 3);
    assert.equal(a.found, false);
    assert.equal(a.verified, false);
  });
  it('handles junk output', () => {
    const a = cleanAnswer({ answer: undefined, found: 'yes', citations: 'x' }, 2);
    assert.deepEqual(a, { answer: '', found: false, citations: [], verified: false });
  });
});

describe('formatSources', () => {
  it('numbers sources and labels their kind', () => {
    const s = formatSources([{ n: 1, kind: 'email', title: 'Lease', from: 'landlord@x.com', at: 0, text: 'Rent goes up.' }]);
    assert.match(s, /^\[1\] Email · .* · from landlord@x\.com · "Lease"\nRent goes up\.$/);
  });
});
