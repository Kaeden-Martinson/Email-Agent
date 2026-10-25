import type { ActivityEntry } from '../../shared/types.js';
import { api, CAT_LABEL, h, relTime, render, run, ui } from '../core.js';
import { button, emptyState, tabs } from '../ui.js';
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
      : 'Everything Lodestar did, newest first. Archive and label can be undone.'));
  const approveAll = activityFilter === 'waiting' && waiting.length > 1
    ? button('Approve all (no sends)', {
        kind: 'primary',
        onClick: () => void run(async () => {
          for (const a of waiting) {
            if (a.action === 'send') continue; // Sends are always approved one at a time.
            await api.approve(a.id);
          }
        }, 'Approved (replies to send still need individual approval)'),
      })
    : undefined;
  wrap.append(tabs<'waiting' | 'all'>(
    [{ id: 'waiting', label: 'Waiting for you', count: waiting.length }, { id: 'all', label: 'Everything', count: ui.state.activity.length }],
    activityFilter, (t) => { activityFilter = t; render(); }, approveAll));
  const list = activityFilter === 'waiting' ? waiting : ui.state.activity;
  if (!list.length) wrap.append(emptyState('Nothing yet. Actions Lodestar takes or proposes will appear here.'));
  else wrap.append(h('div', { class: 'g-tl' }, list.map(activityRow)));
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
  const tone = a.status === 'proposed' ? 'warn' : a.status === 'done' ? 'ok' : a.status === 'failed' ? 'danger' : '';
  const controls =
    a.status === 'proposed'
      ? [button(a.action === 'send' ? 'Approve and send' : 'Approve', { kind: 'primary', tiny: true, onClick: () => void run(() => api.approve(a.id), 'Done') }), button('Reject', { tiny: true, onClick: () => void run(() => api.reject(a.id)) })]
      : a.status === 'done' && a.undoable
        ? [button('Undo', { tiny: true, onClick: () => void run(() => api.undo(a.id), 'Undone') })]
        : [];
  return h('div', { class: 'g-tli' },
    h('span', { class: `g-tdot ${tone}`, title: statusLabel }),
    h('div', { class: 'body' },
      h('div', {},
        h('strong', {}, `${ACTION_LABEL[a.action]}${a.category ? ` as ${CAT_LABEL[a.category]}` : ''}`),
        a.subject ? ` · "${a.subject}"` : '',
        a.sender ? ` · ${a.sender}` : ''),
      h('div', { class: 'hint' },
        `${statusLabel} · ${relTime(a.at)} · ${a.trigger === 'auto' ? 'Automatic' : 'You'} · ${a.reason}` + (ui.state.accounts.length > 1 && account ? ` · ${account.email}` : '')),
      a.error ? h('div', { class: 'err', style: 'color:var(--danger)' }, a.error) : null,
      a.replyText ? h('pre', {}, a.replyText) : null,
      a.status === 'done' && !a.undoable && IRREVERSIBLE[a.action] ? h('div', { class: 'hint' }, IRREVERSIBLE[a.action]!) : null),
    controls.length ? h('div', { class: 'g-acts' }, controls) : null);
}
