import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeStyle, styleRule, styleSamples } from '../src/main/ai/style';
import { message } from './fixtures';

describe('writing style', () => {
  it('uses only your own recent words: quotes, signatures, tiny and bulk messages dropped', () => {
    const sent = [
      message({ receivedAt: 3, body: 'Hey Dana, sounds good. I will send it Friday.\n\nOn Mon, Oct 20, 2026 at 3:12 PM Dana <d@x.io> wrote:\n> old text' }),
      message({ receivedAt: 2, body: 'ok' }),
      message({ receivedAt: 1, body: 'Thanks for the update, I will review the deck tonight.\n-- \nKaeden Martinson\nPhone 555' }),
      message({ receivedAt: 4, body: 'Big newsletter body that should not count at all.', isBulk: true }),
    ];
    const s = styleSamples(sent);
    assert.equal(s.length, 2);
    assert.ok(!s.some((x) => /old text|Phone 555|newsletter/.test(x)));
  });
  it('keeps the description short and single-line, and refuses empty output', () => {
    const st = normalizeStyle({ description: 'Casual,\nshort sentences. ' + 'x'.repeat(400), greeting: 'Hey', signoff: 'Thanks', length: 'huge' }, 5)!;
    assert.ok(st.description.length <= 300 && !st.description.includes('\n'));
    assert.equal(st.length, 'medium');
    assert.equal(normalizeStyle({ description: '' }, 5), undefined);
  });
  it('turns the style into one prompt line', () => {
    assert.equal(styleRule(undefined), '');
    assert.match(styleRule({ description: 'Casual and direct.', greeting: 'Hey', signoff: '', length: 'short', learnedAt: 0, samples: 5 }), /Casual and direct\. They usually open with "Hey"\. Their emails are usually short\./);
  });
});
