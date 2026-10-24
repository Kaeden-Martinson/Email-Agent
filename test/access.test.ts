import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accessBlocker, scopesFor } from '../src/main/core/access';

describe('scopesFor', () => {
  it('read-only asks for read scopes only', () => {
    assert.deepEqual(scopesFor('gmail', 'readonly'), ['https://www.googleapis.com/auth/gmail.readonly']);
    assert.ok(!scopesFor('outlook', 'readonly').some((s) => /ReadWrite|Send/.test(s)));
  });
  it('full access never includes permanent-delete or full-mailbox scopes', () => {
    assert.ok(!scopesFor('gmail', 'full').includes('https://mail.google.com/'));
    assert.deepEqual(scopesFor('outlook', 'full'), ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send']);
  });
});

describe('accessBlocker', () => {
  const ro = { access: 'readonly' as const, email: 'me@x.com' };
  it('blocks every mailbox write on read-only connections', () => {
    for (const a of ['archive', 'label', 'draft', 'send', 'unsubscribe-email'] as const) assert.match(accessBlocker(ro, a)!, /read-only/, a);
  });
  it('allows one-click unsubscribes (no mailbox access involved)', () => {
    assert.equal(accessBlocker(ro, 'unsubscribe'), undefined);
  });
  it('allows everything on full connections, including older accounts without the field', () => {
    assert.equal(accessBlocker({ access: 'full', email: 'a' }, 'send'), undefined);
    assert.equal(accessBlocker({ email: 'a' }, 'archive'), undefined);
  });
});
