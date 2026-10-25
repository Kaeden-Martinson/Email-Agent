import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectForCleanup } from '../src/main/core/cleanup';
import type { Triage, Update } from '../src/shared/types';
import { message } from './fixtures';

const DAY = 86_400_000;
const now = Date.now();
const u = (key: string, daysAgo: number, t: Partial<Triage>, extra: Partial<Update> = {}): Update => ({
  key,
  status: 'new',
  message: message({ receivedAt: now - daysAgo * DAY }),
  triage: { category: 'promo', priority: 3, summary: '', actionItems: [], needsReply: false, draftReply: '', model: 'x', ...t } as Triage,
  ...extra,
});

describe('bulk cleanup selection', () => {
  it('picks old mail in the chosen categories, newest first', () => {
    const list = [u('a', 40, {}), u('b', 35, { category: 'newsletter' }), u('c', 5, {}), u('d', 60, { category: 'fyi' })];
    assert.deepEqual(selectForCleanup(list, { categories: ['promo', 'newsletter'], olderThanDays: 30 }, now).map((x) => x.key), ['b', 'a']);
  });
  it('never touches important mail, mail waiting on a reply, done mail or non-bulk categories', () => {
    const list = [
      u('important', 40, { priority: 1 }),
      u('waiting', 40, { needsReply: true }),
      u('done', 40, {}, { status: 'done' }),
      u('personal', 40, { category: 'reply' }),
      u('ok', 40, { needsReply: true, repliedAlready: true }),
    ];
    assert.deepEqual(selectForCleanup(list, { categories: ['promo', 'reply' as never], olderThanDays: 30 }, now).map((x) => x.key), ['ok']);
  });
  it('ignores untriaged mail', () => {
    assert.deepEqual(selectForCleanup([{ ...u('x', 40, {}), triage: undefined }], { categories: ['promo'], olderThanDays: 1 }, now), []);
  });
});
