import type { KeyItem, KeyItemKind } from '../../shared/types.js';
import { api, btn, h, render, run, ui } from '../core.js';
import { openRemind, remindBox } from './followups.js';

// ---- deadlines, bills and key dates ----

export const KIND_LABEL: Record<KeyItemKind, string> = {
  bill: 'Bill',
  deadline: 'Deadline',
  appointment: 'Appointment',
  event: 'Event',
  delivery: 'Delivery',
  other: 'Date',
};

export const fmtMoney = (i: Pick<KeyItem, 'amount' | 'currency'>) =>
  i.amount === undefined ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: i.currency || 'USD' }).format(i.amount);

export function fmtWhen(i: Pick<KeyItem, 'at' | 'allDay'>): string {
  if (i.at === undefined) return 'No date';
  const d = new Date(i.at);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  return i.allDay ? date : `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** End of day for all-day items, so "due today" isn't overdue until tonight. */
export function deadlineOf(i: KeyItem): number {
  if (i.at === undefined) return Infinity;
  if (!i.allDay) return i.at;
  const d = new Date(i.at);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export const CONFIDENCE: Record<KeyItem['confidence'], [string, string]> = {
  high: ['Stated in the email', 'on'],
  medium: ['Check the details', 'warn'],
  low: ['AI guess', 'bad'],
};

let deadlineKind: KeyItemKind | 'all' = 'all';
const showEvidence = new Set<string>();

export function renderDeadlines(): HTMLElement {
  const wrap = h('div');
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const open = ui.state.items.filter((i) => i.status === 'open' && (deadlineKind === 'all' || i.kind === deadlineKind));
  wrap.append(h('p', { class: 'hint' },
    'Dates and amounts Pilot found in your email. Each one is checked against the email text: "Stated in the email" means the date and amount appear word for word; anything else is marked so you can check it. Pilot never pays bills or moves money.'));
  const kinds = ['all', ...new Set(ui.state.items.filter((i) => i.status === 'open').map((i) => i.kind))] as (KeyItemKind | 'all')[];
  wrap.append(h('div', { class: 'tabs' }, kinds.map((k) =>
    h('button', { class: deadlineKind === k ? 'active' : '', onclick: () => { deadlineKind = k; render(); } }, k === 'all' ? 'All' : `${KIND_LABEL[k]}s`))));

  const groups: [string, KeyItem[]][] = [
    ['Overdue', open.filter((i) => deadlineOf(i) < now)],
    ['Next 7 days', open.filter((i) => deadlineOf(i) >= now && (i.at ?? Infinity) <= week)],
    ['Later', open.filter((i) => i.at !== undefined && i.at > week)],
    ['No date', open.filter((i) => i.at === undefined)],
  ];
  if (!open.length) wrap.append(h('div', { class: 'empty' }, 'No bills, deadlines or appointments found yet.'));
  for (const [title, items] of groups) {
    if (!items.length) continue;
    wrap.append(h('h3', { class: 'section' }, `${title} (${items.length})`));
    for (const i of items.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))) wrap.append(itemRow(i, title === 'Overdue'));
  }
  const done = ui.state.items.filter((i) => i.status === 'done');
  if (done.length) {
    wrap.append(h('details', { class: 'group' }, h('summary', {}, `Done (${done.length})`),
      done.map((i) => h('div', { class: 'hint resolved' }, `${KIND_LABEL[i.kind]}: ${i.title} · ${fmtWhen(i)}`))));
  }
  return wrap;
}

function itemRow(i: KeyItem, overdue: boolean): HTMLElement {
  const [confLabel, confClass] = CONFIDENCE[i.confidence];
  const open = showEvidence.has(i.id);
  return h('div', { class: `banner fu-row ${overdue ? 'overdue' : ''}` },
    h('div', { class: 'grow' },
      h('div', {},
        h('span', { class: 'chip' }, KIND_LABEL[i.kind]), ' ',
        h('strong', {}, i.title),
        i.amount !== undefined ? h('span', { class: 'amount' }, ` ${fmtMoney(i)}`) : null,
        h('span', { class: `pill ${confClass}` }, confLabel),
        overdue ? h('span', { class: 'pill bad' }, 'Overdue') : null),
      h('div', { class: 'hint' }, `${fmtWhen(i)} · from ${i.sender}${i.sourceKeys.length > 1 ? ` · mentioned in ${i.sourceKeys.length} emails` : ''}`),
      i.notes.length ? h('ul', { class: 'item-notes' }, i.notes.map((n) => h('li', {}, n))) : null,
      open ? h('blockquote', { class: 'evidence' }, i.evidence ? `“${i.evidence}”` : 'No quote available.', h('div', { class: 'hint' }, `From "${i.subject}"`)) : null,
      ui.remindFor === `i:${i.id}` ? remindBox({ kind: 'item', id: i.id }) : null),
    h('div', { class: 'row' },
      btn('Done', () => void run(() => api.setItem(i.id, 'done')), 'primary'),
      btn('Remind me…', () => openRemind(`i:${i.id}`)),
      btn(open ? 'Hide source' : 'Show source', () => { if (!showEvidence.delete(i.id)) showEvidence.add(i.id); render(); }, 'ghost'),
      btn('Open email', () => void run(() => api.open(i.key)), 'ghost'),
      btn('Not relevant', () => void run(() => api.setItem(i.id, 'dismissed')), 'ghost')));
}
