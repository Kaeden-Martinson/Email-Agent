import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReplyMime, encodeHeader, isBulkMail, parseAddress, parseListUnsubscribe } from '../src/main/providers/mime';

describe('mime', () => {
  it('strips CR/LF so an email subject cannot inject headers into a reply', () => {
    assert.equal(encodeHeader('Hi\r\nBcc: attacker@evil.com'), 'Hi Bcc: attacker@evil.com');
    const raw = Buffer.from(
      buildReplyMime({ from: 'me@x.com', to: 'you@y.com', subject: 'Re: hi\r\nBcc: attacker@evil.com', text: 'ok' }),
      'base64url',
    ).toString('utf8');
    assert.equal(/^Bcc:/m.test(raw), false);
  });
  it('parses List-Unsubscribe and the one-click marker', () => {
    assert.deepEqual(parseListUnsubscribe('<mailto:u@x.com>, <https://x.com/u>', 'List-Unsubscribe=One-Click'), {
      mailto: 'mailto:u@x.com',
      url: 'https://x.com/u',
      oneClick: true,
    });
    assert.equal(parseListUnsubscribe('<http://insecure.example/u>'), undefined);
    assert.equal(parseListUnsubscribe('<https://x.com/u>')?.oneClick, false);
  });
  it('detects bulk mail from headers', () => {
    assert.ok(isBulkMail('<https://x>', undefined, undefined));
    assert.ok(isBulkMail(undefined, 'bulk', undefined));
    assert.ok(isBulkMail(undefined, undefined, 'auto-generated'));
    assert.equal(isBulkMail(undefined, undefined, 'no'), false);
  });
  it('parses display names', () => {
    assert.deepEqual(parseAddress('"Dana Kim" <dana@studio.io>'), { name: 'Dana Kim', email: 'dana@studio.io' });
    assert.deepEqual(parseAddress('dana@studio.io'), { name: '', email: 'dana@studio.io' });
  });
});
