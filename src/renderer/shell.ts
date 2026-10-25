import { api, btn, go, h, relTime, run, ui, type View } from './core.js';
import { dueCount, itemsDueSoon } from './views/today.js';

/** One-time notices from the app, e.g. data restored from a backup. */
export function renderNotice(): HTMLElement | null {
  const n = ui.state.app.notice;
  if (!n) return null;
  return h('div', { class: 'banner approve-banner' }, h('strong', {}, 'Heads up: '), n,
    h('div', { class: 'actions' }, btn('Dismiss', () => void run(() => api.dismissNotice()))));
}

export function renderNav(): HTMLElement {
  const open = ui.state.updates.filter((u) => u.status === 'new').length;
  const watching = ui.state.accounts.filter((a) => a.watching).length;
  const suggestions = ui.state.subscriptions.filter((s) => !s.unsubscribedAt && s.count >= 2).length;
  const proposed = ui.state.activity.filter((a) => a.status === 'proposed').length;
  const item = (v: View, label: string, count?: string) =>
    h(
      'button',
      { class: ui.view === v ? 'active' : '', onclick: () => go(v) },
      h('span', {}, label),
      count ? h('span', { class: 'count' }, count) : null,
    );
  return h(
    'nav',
    {},
    h('div', { class: 'brand' }, 'Inbox Pilot',
      h('small', {}, ui.state.status.demo ? 'Demo mode' : ui.state.settings.userName ? `${ui.state.settings.userName}'s Pilot` : 'Your email Pilot')),
    item('today', 'Today'),
    item('ask', 'Ask', 'Ctrl+K'),
    item('updates', 'Updates', open ? String(open) : undefined),
    item('deadlines', 'Deadlines', itemsDueSoon() ? `${itemsDueSoon()} soon` : undefined),
    item('followups', 'Follow-ups', dueCount() ? `${dueCount()} due` : undefined),
    item('mailboxes', 'Mailboxes', ui.state.accounts.length ? `${watching}/${ui.state.accounts.length}` : undefined),
    item('subscriptions', 'Subscriptions', suggestions ? String(suggestions) : undefined),
    item('activity', 'Activity', proposed ? String(proposed) : undefined),
    item('sorting', 'Rules', ui.state.suggestedRules.length ? `${ui.state.suggestedRules.length} new` : undefined),
    item('rules', 'Replies'),
    item('notifications', 'Notifications', ui.state.notifier.held ? `${ui.state.notifier.held} held` : undefined),
    item('settings', 'Settings'),
  );
}

export function renderHeader(): HTMLElement {
  const titles: Record<View, string> = {
    today: 'Today',
    ask: 'Ask my inbox',
    updates: 'Updates',
    deadlines: 'Deadlines & bills',
    followups: 'Follow-ups',
    mailboxes: 'Mailboxes',
    subscriptions: 'Subscriptions',
    activity: 'Activity',
    sorting: 'Rules',
    rules: 'Replies',
    notifications: 'Notifications',
    settings: 'Settings',
  };
  const s = ui.state.status;
  const msg = s.message ?? (s.lastRunAt ? `Checked ${relTime(s.lastRunAt)}` : '');
  return h(
    'header',
    { class: 'top' },
    h('h1', {}, titles[ui.view]),
    h('span', { class: `status ${s.ollamaOk === false ? 'warn' : ''}` }, msg),
    btn(s.syncing ? 'Checking…' : 'Check now', () => void run(() => api.syncNow()), '', s.syncing),
  );
}
