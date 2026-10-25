import { api, go, h, relTime, run, ui, type View } from './core.js';
import { icon, type IconName } from './icons.js';
import { nextTheme } from './theme.js';
import { banner, button } from './ui.js';
import { dueCount, itemsDueSoon } from './views/today.js';

const NAV: { v: View; label: string; icon: IconName }[] = [
  { v: 'today', label: 'Today', icon: 'home' }, { v: 'updates', label: 'Updates', icon: 'inbox' }, { v: 'ask', label: 'Ask', icon: 'search' },
  { v: 'deadlines', label: 'Deadlines', icon: 'calendar' }, { v: 'followups', label: 'Follow-ups', icon: 'reply' }, { v: 'mailboxes', label: 'Mailboxes', icon: 'mail' },
  { v: 'subscriptions', label: 'Subscriptions', icon: 'news' }, { v: 'activity', label: 'Activity', icon: 'list' }, { v: 'sorting', label: 'Rules', icon: 'rules' },
  { v: 'rules', label: 'Replies', icon: 'pen' }, { v: 'notifications', label: 'Notifications', icon: 'bell' }, { v: 'settings', label: 'Settings', icon: 'gear' },
];

const count = (n: number) => (n ? String(n) : undefined);

export function renderNav(): HTMLElement {
  const s = ui.state;
  const counts: Partial<Record<View, string>> = {
    updates: count(s.updates.filter((u) => u.status === 'new').length),
    ask: 'Ctrl K',
    deadlines: count(itemsDueSoon()),
    followups: count(dueCount()),
    subscriptions: count(s.subscriptions.filter((x) => !x.unsubscribedAt && x.count >= 2).length),
    activity: count(s.activity.filter((a) => a.status === 'proposed').length),
    sorting: count(s.suggestedRules.length),
    notifications: count(s.notifier.held),
  };
  const watching = s.accounts.filter((a) => a.watching).length;
  const themeIcon = document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon';
  return h('aside', { class: 'g-side' },
    h('div', { class: 'g-brand' }, h('span', { class: 'mark' }, icon('pilot', 12)),
      h('div', {}, 'Inbox Pilot', h('small', {}, s.status.demo ? 'Demo mode' : s.settings.userName ? `${s.settings.userName}'s Pilot` : 'Your email Pilot'))),
    NAV.map((n) => h('button', { type: 'button', class: `g-nav${ui.view === n.v ? ' on' : ''}`, onclick: () => go(n.v), 'aria-current': ui.view === n.v ? 'page' : null },
      icon(n.icon), n.label, counts[n.v] ? h('span', { class: 'n' }, counts[n.v]!) : null)),
    h('div', { class: 'g-side-foot' },
      h('span', { class: `g-dot${watching ? '' : ' off'}` }),
      watching ? `Watching ${watching} mailbox${watching === 1 ? '' : 'es'}` : 'Not watching',
      h('span', { style: 'flex:1' }),
      button('', { kind: 'ghost', icon: themeIcon, title: 'Switch light or dark', onClick: () => void run(() => api.saveSettings({ appearance: nextTheme(s.settings.appearance) })) })));
}

export function pageTitle(v: View): string {
  return { today: 'Today', ask: 'Ask my inbox', updates: 'Updates', deadlines: 'Deadlines and bills', followups: 'Follow-ups', mailboxes: 'Mailboxes',
    subscriptions: 'Subscriptions', activity: 'Activity', sorting: 'Rules', rules: 'Replies', notifications: 'Notifications', settings: 'Settings' }[v];
}

export function renderHeader(): HTMLElement {
  const s = ui.state.status;
  const msg = s.message ?? (s.lastRunAt ? `Checked ${relTime(s.lastRunAt)}` : '');
  return h('header', { class: 'g-head' },
    h('h1', {}, pageTitle(ui.view)),
    h('span', { class: `status${s.ollamaOk === false ? ' warn' : ''}` }, msg),
    button(s.syncing ? 'Checking…' : 'Check now', { icon: 'refresh', disabled: s.syncing, onClick: () => void run(() => api.syncNow()) }));
}

/** One-time notices from the app, e.g. data restored from a backup. */
export function renderNotice(): HTMLElement | null {
  const n = ui.state.app.notice;
  if (!n) return null;
  return banner('warn', [h('strong', {}, 'Heads up. '), n], [button('Dismiss', { kind: 'ghost', onClick: () => void run(() => api.dismissNotice()) })]);
}
