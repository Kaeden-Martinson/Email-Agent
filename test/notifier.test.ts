import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Formatted } from '../src/main/core/notify';
import { Notifier } from '../src/main/notifier';
import { DEFAULT_SETTINGS } from '../src/main/store';
import type { Settings } from '../src/shared/types';

function setup(mutate: (s: Settings) => void = () => {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  mutate(settings);
  const store = { data: { notify: { log: {}, held: [], phoneTimes: [], status: {} } } } as never;
  const desktop: Formatted[] = [];
  const n = new Notifier({ store, settings: () => settings, changed() {}, desktop: (f) => desktop.push(f) });
  return { n, settings, desktop, data: (store as { data: { notify: { held: unknown[]; log: Record<string, number> } } }).data.notify };
}

const urgent = { event: 'urgent' as const, key: 'urgent:1', sender: 'Bank', subject: 'Overdue $90', detail: 'Pay now' };

let sent: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Notifier', () => {
  it('shows desktop notifications at the desktop level and never twice', async () => {
    const { n, desktop } = setup();
    await n.notify(urgent);
    await n.notify(urgent);
    assert.equal(desktop.length, 1);
    assert.match(desktop[0].body, /Bank/);
  });
  it('respects the master switch and per-event toggles', async () => {
    const off = setup((s) => (s.notifications.enabled = false));
    await off.n.notify(urgent);
    assert.equal(off.desktop.length, 0);
    const noUrgent = setup((s) => (s.notifications.desktop.events.urgent = false));
    await noUrgent.n.notify(urgent);
    assert.equal(noUrgent.desktop.length, 0);
  });
  it('sends phone notifications at minimal by default, with no details', async () => {
    const { n } = setup((s) => Object.assign(s.notifications.ntfy, { enabled: true, topic: 'pilot-test' }));
    await n.notify(urgent);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.topic, 'pilot-test');
    assert.doesNotMatch(JSON.stringify(sent[0].body), /Bank|Overdue|90|Pay now/);
    assert.equal(sent[0].body.priority, 4);
  });
  it('holds everything during quiet hours, then sends one summary', async () => {
    const h = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = Date.now();
    const { n, settings, desktop, data } = setup((s) => {
      s.notifications.quiet = { enabled: true, start: h(new Date(now - 60_000)), end: h(new Date(now + 3_600_000)), allowUrgent: false };
    });
    await n.notify(urgent);
    await n.notify({ event: 'reminder', key: 'r1', subject: 'x' });
    assert.equal(desktop.length, 0);
    assert.equal(data.held.length, 2);
    await n.tick();
    assert.equal(desktop.length, 0, 'still quiet');
    settings.notifications.quiet.enabled = false;
    await n.tick();
    assert.equal(desktop.length, 1);
    assert.match(desktop[0].body, /1 important email, 1 reminder/);
    assert.equal(data.held.length, 0);
  });
  it('lets urgent mail through quiet hours when allowed', async () => {
    const { n, desktop } = setup((s) => (s.notifications.quiet = { enabled: true, start: '00:00', end: '23:59', allowUrgent: true }));
    await n.notify(urgent);
    assert.equal(desktop.length, 1);
  });
  it('rate-limits phone channels and folds the rest into the summary', async () => {
    const { n, data } = setup((s) => {
      Object.assign(s.notifications.ntfy, { enabled: true, topic: 't' });
      s.notifications.desktop.enabled = false;
      s.notifications.maxPerHour = 2;
    });
    for (let i = 0; i < 4; i++) await n.notify({ ...urgent, key: `u${i}` });
    assert.equal(sent.length, 2);
    assert.equal(data.held.length, 2);
  });
  it('records delivery failures instead of throwing', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const { n } = setup((s) => Object.assign(s.notifications.ntfy, { enabled: true, topic: 't' }));
    await n.notify(urgent);
    assert.match(n.status().channels.ntfy.lastError!, /500/);
  });
});
