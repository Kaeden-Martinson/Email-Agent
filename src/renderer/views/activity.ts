import type { ActivityEntry } from '../../shared/types.js';
import { api, btn, CAT_LABEL, h, relTime, render, run, ui } from '../core.js';
import { ACTION_LABEL } from './updates.js';

// ---- activity ----

let activityFilter: 'waiting' | 'all' = 'waiting';

const IRREVERSIBLE: Partial<Record<ActivityEntry['action'], string>> = {
  send: "Sent mail can't be recalled.",
  draft: 'Delete the draft in your mailbox if you no longer want it.',
  unsubscribe: "Can't be reversed here; re-subscribe on the sender's site.",
};

export function renderActivity(): HTMLElement {
  const wrap = h('div');
  const waiting = ui.state.activity.filter((a) => a.status === 'proposed');
  if (activityFilter === 'waiting' && !waiting.length) activityFilter = 'all';
  wrap.append(h('p', { class: 'hint' },
    ui.state.settings.previewMode
      ? 'Preview mode is on: automatic actions wait here for your approval. Turn it off in Settings once you trust them.'
      : 'Everything Pilot did, newest first. Archive and label can be undone.'));
  wrap.append(h('div', { class: 'tabs' },
    h('button', { class: activityFilter === 'waiting' ? 'active' : '', onclick: () => { activityFilter = 'waiting'; render(); } }, `Waiting for approval (${waiting.length})`),
    h('button', { class: activityFilter === 'all' ? 'active' : '', onclick: () => { activityFilter = 'all'; render(); } }, `All (${ui.state.activity.length})`)));
  const list = activityFilter === 'waiting' ? waiting : ui.state.activity;
  if (!list.length) wrap.append(h('div', { class: 'empty' }, 'Nothing yet. Actions Pilot takes or proposes will appear here.'));
  if (activityFilter === 'waiting' && waiting.length > 1) {
    wrap.append(h('div', { class: 'actions top-actions' },
      btn(`Approve all ${waiting.length}`, () => void run(async () => {
        for (const a of waiting) {
          if (a.action === 'send') continue; // Sends are always approved one at a time.
          await api.approve(a.id);
        }
      }, 'Approved (replies to send still need individual approval)'), 'primary')));
  }
  for (const a of list) wrap.append(activityRow(a));
  return wrap;
}

function activityRow(a: ActivityEntry): HTMLElement {
  const account = ui.state.accounts.find((x) => x.id === a.accountId);
  const statusLabel = {
    proposed: 'Waiting for approval',
    done: a.trigger === 'auto' ? (a.approved ? 'Done, approved by you' : 'Done automatically') : 'Done by you',
    failed: 'Failed',
    undone: 'Undone',
    rejected: 'Rejected',
  }[a.status];
  const controls =
    a.status === 'proposed'
      ? [btn(a.action === 'send' ? 'Approve and send' : 'Approve', () => void run(() => api.approve(a.id), 'Done'), 'primary'), btn('Reject', () => void run(() => api.reject(a.id)))]
      : a.status === 'done' && a.undoable
        ? [btn('Undo', () => void run(() => api.undo(a.id), 'Undone'))]
        : [];
  return h('div', { class: `banner activity-row s-${a.status}` },
    h('div', { class: 'grow' },
      h('div', {},
        h('strong', {}, `${ACTION_LABEL[a.action]}${a.category ? ` as ${CAT_LABEL[a.category]}` : ''}`),
        a.subject ? ` · "${a.subject}"` : '',
        a.sender ? ` · ${a.sender}` : '',
        h('span', { class: `pill ${a.status === 'done' ? 'on' : a.status === 'failed' ? 'bad' : 'off'}` }, statusLabel)),
      h('div', { class: 'hint' },
        `${relTime(a.at)} · ${a.trigger === 'auto' ? 'Automatic' : 'You'} · ${a.reason}` + (ui.state.accounts.length > 1 && account ? ` · ${account.email}` : '')),
      a.error ? h('div', { class: 'err' }, a.error) : null,
      a.replyText ? h('pre', { class: 'original' }, a.replyText) : null,
      a.status === 'done' && !a.undoable && IRREVERSIBLE[a.action] ? h('div', { class: 'hint' }, IRREVERSIBLE[a.action]!) : null),
    h('div', { class: 'row' }, controls));
}
