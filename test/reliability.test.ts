import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrate, SCHEMA_VERSION } from '../src/main/core/migrate';
import { redact, scrubText } from '../src/main/core/redact';
import { backoffMs, retryAfterMs, withRetry } from '../src/main/core/retry';
import { compareVersions, parseFeed } from '../src/main/core/version';
import { pickModel } from '../src/main/core/models';

describe('redact', () => {
  it('removes email content and credentials', () => {
    const out = redact({
      event: 'sync',
      subject: 'Your lease',
      body: 'private text',
      accessToken: 'ya29.secret',
      nested: { password: 'hunter2', count: 3 },
    }) as Record<string, unknown>;
    assert.equal(out.subject, '[redacted]');
    assert.equal(out.body, '[redacted]');
    assert.equal(out.accessToken, '[redacted]');
    assert.deepEqual(out.nested, { password: '[redacted]', count: 3 });
    assert.equal(out.event, 'sync');
  });
  it('masks addresses and tokens inside free text', () => {
    assert.equal(scrubText('failed for dana@studio.io'), 'failed for d***@studio.io');
    assert.equal(scrubText('Authorization: Bearer abc.def-123'), 'Authorization: Bearer [redacted]');
    assert.match(scrubText(`token ${'x'.repeat(40)}`), /token \[redacted\]/);
  });
  it('shortens long strings and keeps errors readable', () => {
    assert.ok((redact('a '.repeat(400)) as string).length <= 301);
    assert.deepEqual(redact(new Error('boom for a@b.co')), { name: 'Error', message: 'boom for a***@b.co' });
  });
});

const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe('withRetry', () => {
  it('retries rate limits, honouring Retry-After', async () => {
    const waits: number[] = [];
    const statuses = [429, 503, 200];
    const r = await withRetry(async () => res(statuses.shift()!, { 'retry-after': '2' }), { sleep: async (ms) => void waits.push(ms) });
    assert.equal(r.status, 200);
    assert.deepEqual(waits, [2000, 2000]);
  });
  it('does not retry client errors', async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return res(403);
    }, { sleep: async () => {} });
    assert.equal(r.status, 403);
    assert.equal(calls, 1);
  });
  it('gives up after the retry budget and returns the last response', async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return res(503);
    }, { retries: 2, sleep: async () => {} });
    assert.equal(r.status, 503);
    assert.equal(calls, 3);
  });
  it('retries network failures, then throws', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw new TypeError('fetch failed');
    }, { retries: 1, sleep: async () => {} }));
    assert.equal(calls, 2);
  });
  it('caps waits and adds jitter', () => {
    assert.equal(backoffMs(10, () => 1, 30_000), 30_000);
    assert.ok(backoffMs(0, () => 0, 30_000) >= 375 && backoffMs(0, () => 1, 30_000) <= 625);
    assert.equal(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:00 GMT')), 60_000);
    assert.equal(retryAfterMs('soon'), undefined);
  });
});

describe('migrate', () => {
  it('upgrades a v1 file and fills new collections', () => {
    const out = migrate({ version: 1, accounts: [{ id: 'a', kind: 'gmail', email: 'x@y.z', addedAt: 0 }] as never });
    assert.equal(out.schemaVersion, SCHEMA_VERSION);
    const acc = (out.accounts as { watching: boolean; providerName: string; permissions: { replies: string } }[])[0];
    assert.equal(acc.watching, true);
    assert.equal(acc.providerName, 'Gmail');
    assert.equal(acc.permissions.replies, 'off');
    assert.deepEqual(out.rules, []);
    assert.deepEqual(out.notify, { log: {}, held: [], phoneTimes: [], status: {} });
  });
  it('keeps existing data', () => {
    const out = migrate({ version: 1, rules: [{ id: 'r' }] as never, accounts: [] as never });
    assert.deepEqual(out.rules, [{ id: 'r' }]);
  });
  it('is a no-op for current files and refuses newer ones', () => {
    assert.equal(migrate({ schemaVersion: SCHEMA_VERSION }).schemaVersion, SCHEMA_VERSION);
    assert.throws(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 }), /newer version/);
  });
});


describe('update checks', () => {
  it('compares versions numerically', () => {
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('v1.2.0', '1.2'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1);
    assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
    assert.equal(compareVersions('0.2.0', '0.3.0'), -1);
  });
  it('reads simple and GitHub feeds', () => {
    assert.deepEqual(parseFeed({ version: '0.3.0', url: 'https://example.com/setup.exe', notes: 'Fixes' }), { version: '0.3.0', url: 'https://example.com/setup.exe', notes: 'Fixes' });
    assert.equal(parseFeed({ tag_name: 'v0.4.1', html_url: 'https://github.com/x/y/releases/v0.4.1', body: '' }).version, '0.4.1');
  });
  it('rejects feeds without a version or a safe link', () => {
    assert.throws(() => parseFeed({ version: 'latest', url: 'https://x' }), /version/);
    assert.throws(() => parseFeed({ version: '1.0.0', url: 'http://insecure.example/setup.exe' }), /https/);
  });
});


describe('pickModel', () => {
  const installed = ['quill-editor:latest', 'nomic-embed-text:latest', 'gemma4:e4b', 'qwen2.5:7b'];
  it('prefers reliable general chat models', () => {
    assert.equal(pickModel(installed), 'qwen2.5:7b');
  });
  it('skips models that failed to load, embedding models and fine-tunes', () => {
    assert.equal(pickModel(installed, new Set(['qwen2.5:7b'])), 'gemma4:e4b');
    assert.equal(pickModel(installed, new Set(['qwen2.5:7b', 'gemma4:e4b'])), undefined);
  });
});
