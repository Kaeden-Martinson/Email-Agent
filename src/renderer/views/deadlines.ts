import type { KeyItem, KeyItemKind } from '../../shared/types.js';
import { api, h, render, run, ui } from '../core.js';
import { icon, type IconName } from '../icons.js';
import { button, chip, emptyState, sectionTitle, table, tabs } from '../ui.js';
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
let showDone = false;
const showEvidence = new Set<string>();

const KIND_ICON: Record<KeyItemKind, IconName> = { bill: 'bill', deadline: 'clock', appointment: 'calendar', event: 'calendar', delivery: 'mail', other: 'clock' };
const TABS: { id: KeyItemKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'bill', label: 'Bills' }, { id: 'deadline', label: 'Deadlines' },
  { id: 'appointment', label: 'Appointments' }, { id: 'event', label: 'Events' }, { id: 'delivery', label: 'Deliveries' },
];
const COLUMNS = [{ label: 'Date' }, { label: 'What' }, { label: 'Amount', align: 'right' as const }, { label: '', align: 'right' as const }];

function dateCell(i: KeyItem): HTMLElement {
  if (i.at === undefined) return h('span', { class: 'muted' }, 'No date');
  const d = new Date(i.at);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  return h('span', { style: 'white-space:nowrap' }, date, i.allDay ? null : h('span', { class: 'muted small' }, ` ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
}

function titleCell(i: KeyItem): HTMLElement {
  const [confLabel] = CONFIDENCE[i.confidence];
  return h('div', { style: 'display:flex;align-items:center;gap:8px;min-width:0' },
    icon(KIND_ICON[i.kind], 16),
    h('div', { style: 'min-width:0' },
      h('div', {}, h('a', { href: '#', class: 'ev-toggle', title: confLabel, style: 'font-weight:600;color:inherit;text-decoration:none', onclick: (e: Event) => { e.preventDefault(); if (!showEvidence.delete(i.id)) showEvidence.add(i.id); render(); } }, i.title),
        i.notes.length ? ' ' : null, i.notes.length ? chip('Check', 'warn') : null),
      h('div', { class: 'muted small' }, `${KIND_LABEL[i.kind]} · from ${i.sender}${i.sourceKeys.length > 1 ? ` · in ${i.sourceKeys.length} emails` : ''}`)));
}

function actionsCell(i: KeyItem): HTMLElement {
  return h('div', { style: 'display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap' },
    button('Done', { tiny: true, icon: 'check', onClick: () => void run(() => api.setItem(i.id, 'done')) }),
    button('Remind me', { tiny: true, kind: 'ghost', onClick: () => openRemind(`i:${i.id}`) }),
    button('Open email', { tiny: true, kind: 'ghost', onClick: () => void run(() => api.open(i.key)) }),
    button('Dismiss', { tiny: true, kind: 'ghost', onClick: () => void run(() => api.setItem(i.id, 'dismissed')) }));
}

function extraRow(i: KeyItem): HTMLElement | null {
  const open = showEvidence.has(i.id);
  const remind = ui.remindFor === `i:${i.id}`;
  if (!open && !remind) return null;
  const [confLabel] = CONFIDENCE[i.confidence];
  return h('tr', {}, h('td', { colSpan: 4 },
    open ? h('div', { class: 'small' },
      h('div', { class: 'muted' }, confLabel),
      h('blockquote', { style: 'margin:6px 0' }, i.evidence ? `“${i.evidence}”` : 'No quote available.', h('div', { class: 'muted small' }, `From "${i.subject}"`)),
      i.notes.length ? h('ul', {}, i.notes.map((n) => h('li', {}, n))) : null) : null,
    remind ? remindBox({ kind: 'item', id: i.id }) : null));
}

/** Same column widths in every group so the weekly list lines up. */
function fixWidths(t: HTMLTableElement): void {
  t.style.tableLayout = 'fixed';
  ['19%', '', '11%', '38%'].forEach((w, i) => { const th = t.tHead?.rows[0].cells[i]; if (th && w) th.style.width = w; });
}

function itemTable(items: KeyItem[]): HTMLTableElement {
  const t = table(COLUMNS, items.map((i) => ({ cells: [dateCell(i), titleCell(i), h('span', { class: 'num' }, fmtMoney(i)), actionsCell(i)] })));
  fixWidths(t);
  const body = t.tBodies[0];
  items.forEach((i, idx) => { const x = extraRow(i); if (x) body.rows[idx].after(x); });
  return t;
}

/** Monday 00:00 following the given day. */
function nextMonday(from: number): number {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.getTime();
}

export function renderDeadlines(): HTMLElement {
  const wrap = h('div');
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const mon = nextMonday(startOfToday);
  const mon2 = mon + 7 * 86_400_000;
  const w = ui.state.weekly;
  const total = w?.billTotal !== undefined
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: w.currency || 'USD' }).format(w.billTotal)
    : String(w?.bills ?? 0);
  wrap.append(tabs(TABS, deadlineKind, (k) => { deadlineKind = k; render(); },
    h('span', { class: 'muted small num' }, `${total} due in the next 2 weeks`)));
  wrap.append(h('p', { class: 'muted small' },
    'Dates and amounts Pilot found in your email, each checked against the email text. Click a title to see the quote and any notes. Pilot never pays bills or moves money.'));

  const open = ui.state.items.filter((i) => i.status === 'open' && (deadlineKind === 'all' || i.kind === deadlineKind))
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  const groups: [string, KeyItem[]][] = [
    ['Past due', open.filter((i) => i.at !== undefined && i.at < startOfToday)],
    ['This week', open.filter((i) => i.at !== undefined && i.at >= startOfToday && i.at < mon)],
    ['Next week', open.filter((i) => i.at !== undefined && i.at >= mon && i.at < mon2)],
    ['Later', open.filter((i) => i.at !== undefined && i.at >= mon2)],
    ['No date', open.filter((i) => i.at === undefined)],
  ];
  if (!open.length) wrap.append(emptyState('No bills, deadlines or appointments found yet.'));
  for (const [name, items] of groups) {
    if (!items.length) continue;
    wrap.append(sectionTitle(name, items.length), itemTable(items));
  }

  const done = ui.state.items.filter((i) => i.status !== 'open' && (deadlineKind === 'all' || i.kind === deadlineKind));
  if (done.length) {
    wrap.append(h('div', { style: 'margin-top:16px' }, button(showDone ? 'Hide done' : `Show done (${done.length})`, { kind: 'ghost', tiny: true, onClick: () => { showDone = !showDone; render(); } })));
    if (showDone) {
      wrap.append(h('div', { class: 'muted' }, table(COLUMNS.slice(0, 3), done.map((i) => ({
        cells: [dateCell(i), h('span', {}, `${i.title} `, h('span', { class: 'small' }, `(${i.status === 'done' ? 'done' : 'dismissed'})`)), h('span', { class: 'num' }, fmtMoney(i))],
      })))));
    }
  }
  return wrap;
}
