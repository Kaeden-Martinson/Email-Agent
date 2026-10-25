import { api, btn, go, h, relTime, run, ui, type View } from '../core.js';
import { aiSetupPanel, aiStatus } from './aisetup.js';
import { deadlineOf, fmtMoney, fmtWhen, KIND_LABEL } from './deadlines.js';
import { renderBriefing } from './updates.js';

// ---- today: the command center ----

function greeting(): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return ui.state.settings.userName ? `${part}, ${ui.state.settings.userName}` : part;
}

interface Agenda {
  at: number;
  allDay: boolean;
  label: string;
  title: string;
  detail: string;
  overdue: boolean;
  go: View;
}

/** Everything with a date in the next 7 days, plus anything overdue, on one timeline. */
function agenda(): Agenda[] {
  const now = Date.now();
  const until = now + 7 * 86_400_000;
  const out: Agenda[] = [];
  for (const i of ui.state.items.filter((x) => x.status === 'open' && x.at !== undefined && x.at <= until)) {
    out.push({ at: i.at!, allDay: i.allDay, label: KIND_LABEL[i.kind], title: `${i.title}${i.amount !== undefined ? ` · ${fmtMoney(i)}` : ''}`, detail: i.sender, overdue: deadlineOf(i) < now, go: 'deadlines' });
  }
  for (const c of ui.state.commitments.filter((x) => x.status === 'open' && x.dueAt && x.dueAt <= until)) {
    out.push({ at: c.dueAt!, allDay: false, label: 'You promised', title: c.text, detail: c.withWhom ?? '', overdue: c.dueAt! < now, go: 'followups' });
  }
  for (const f of ui.state.followUps.filter((x) => x.status === 'waiting' && x.dueAt <= until)) {
    out.push({ at: f.dueAt, allDay: false, label: 'Follow up', title: f.subject || '(no subject)', detail: f.to.email, overdue: f.dueAt < now, go: 'followups' });
  }
  for (const r of ui.state.reminders.filter((x) => (x.status === 'pending' && x.at <= until) || x.status === 'due')) {
    out.push({ at: r.at, allDay: false, label: 'Reminder', title: r.title, detail: `"${r.phrase}"`, overdue: r.status === 'due', go: 'followups' });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.at - b.at);
}

function tile(value: number, label: string, target: View, warn = false): HTMLElement {
  return h('button', { class: `tile ${warn && value ? 'warn' : ''}`, type: 'button', onclick: () => go(target) },
    h('div', { class: 'tile-value' }, String(value)),
    h('div', { class: 'tile-label' }, label));
}

/** "Your week": counts from the last 7 days and the next 14. */
function weekCard(): HTMLElement {
  const w = ui.state.weekly;
  const money = w.billTotal !== undefined && w.currency
    ? ` (${new Intl.NumberFormat(undefined, { style: 'currency', currency: w.currency }).format(w.billTotal)} total)`
    : '';
  return h('section', { class: 'group' },
    h('h2', {}, 'Your week'),
    h('div', { class: 'banner' },
      h('ul', { class: 'todos' },
        h('li', {}, `${w.received} emails in the last 7 days, ${w.important} important`),
        h('li', {}, `Pilot did ${w.autoActions} thing${w.autoActions === 1 ? '' : 's'} on its own; you sent ${w.repliesSent} repl${w.repliesSent === 1 ? 'y' : 'ies'} and archived ${w.archived}`),
        h('li', {}, `Next 2 weeks: ${w.bills} bill${w.bills === 1 ? '' : 's'}${money} and ${w.deadlines} other deadline${w.deadlines === 1 ? '' : 's'}`),
        h('li', {}, `Waiting on ${w.waitingOn} repl${w.waitingOn === 1 ? 'y' : 'ies'}; you owe ${w.owed}`),
        w.noisiest.length
          ? h('li', {}, `Noisiest senders: ${w.noisiest.map((n) => `${n.name} (${n.count})`).join(', ')} `, btn('Clean up', () => go('subscriptions'), 'tiny'))
          : null)));
}

export function renderToday(): HTMLElement {
  const wrap = h('div', { class: 'today' });
  const open = ui.state.updates.filter((u) => u.status === 'new');
  const needYou = open.filter((u) => u.triage?.priority === 1);
  const items = agenda();
  const waitingOn = ui.state.followUps.filter((f) => f.status === 'waiting');
  const proposed = ui.state.activity.filter((a) => a.status === 'proposed').length;

  for (const a of ui.state.accounts.filter((x) => x.needsReconnect && x.kind !== 'imap')) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `${a.email} needs to be reconnected. `), 'The sign-in expired (Google does this weekly while the app is in Testing). Your data is kept.',
      h('div', { class: 'actions' }, btn('Reconnect', () =>
        void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: a.calendar }), 'Reconnected. Checking mail…'), 'primary'))));
  }
  const up = ui.state.app.update;
  if (up?.available && up.url) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `Pilot ${up.latest} is available. `), `You have ${ui.state.app.version}.`,
      h('div', { class: 'actions' }, btn('Download', () => void run(() => api.openUrl(up.url!)), 'primary'))));
  }
  if (ui.state.status.ollamaOk === false || (aiStatus && !aiStatus.ready)) {
    wrap.append(h('section', { class: 'group' }, h('h2', {}, 'Finish setting up the AI'), aiSetupPanel()));
  }
  wrap.append(h('div', { class: 'today-head' },
    h('h2', {}, greeting()),
    h('div', { class: 'hint' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))));

  if (!ui.state.accounts.some((a) => a.watching)) {
    wrap.append(h('div', { class: 'banner' }, h('strong', {}, "Pilot isn't watching any mailbox yet. "),
      h('div', { class: 'actions' }, btn('Go to Mailboxes', () => go('mailboxes'), 'primary'))));
    return wrap;
  }

  wrap.append(h('div', { class: 'tiles' },
    tile(needYou.length, 'need you today', 'updates', true),
    tile(items.filter((a) => a.overdue).length, 'overdue', 'deadlines', true),
    tile(ui.state.owed.length, 'replies you owe', 'followups'),
    tile(waitingOn.length, 'waiting on others', 'followups'),
    tile(proposed, 'awaiting approval', 'activity', true)));

  wrap.append(renderBriefing());

  wrap.append(h('h3', { class: 'section' }, 'Needs you now'));
  if (!needYou.length) wrap.append(h('div', { class: 'empty small' }, 'Nothing urgent.'));
  for (const u of needYou.slice(0, 5)) {
    wrap.append(h('button', { class: 'today-row', type: 'button', onclick: () => { ui.tab = 'open'; go('updates'); } },
      h('span', { class: 'today-when' }, relTime(u.message.receivedAt)),
      h('span', { class: 'grow' }, h('strong', {}, u.message.from.name || u.message.from.email), ` · ${u.triage!.summary}`)));
  }

  wrap.append(h('h3', { class: 'section' }, 'Coming up (next 7 days)'));
  if (!items.length) wrap.append(h('div', { class: 'empty small' }, 'Nothing scheduled. Bills, deadlines, appointments, promises and follow-ups will appear here.'));
  for (const a of items) {
    wrap.append(h('button', { class: `today-row ${a.overdue ? 'overdue' : ''}`, type: 'button', onclick: () => go(a.go) },
      h('span', { class: 'today-when' }, a.overdue ? 'Overdue' : fmtWhen({ at: a.at, allDay: a.allDay })),
      h('span', { class: 'chip' }, a.label),
      h('span', { class: 'grow' }, h('strong', {}, a.title), a.detail ? h('span', { class: 'hint' }, ` · ${a.detail}`) : null)));
  }

  if (ui.state.owed.length || waitingOn.length) {
    wrap.append(h('h3', { class: 'section' }, 'Conversations'));
    for (const o of ui.state.owed.slice(0, 3)) {
      wrap.append(h('button', { class: 'today-row', type: 'button', onclick: () => go('followups') },
        h('span', { class: 'today-when' }, relTime(o.receivedAt)), h('span', { class: 'chip' }, 'You owe'),
        h('span', { class: 'grow' }, h('strong', {}, o.from.name || o.from.email), ` · ${o.subject}`)));
    }
    for (const f of waitingOn.slice(0, 3)) {
      wrap.append(h('button', { class: 'today-row', type: 'button', onclick: () => go('followups') },
        h('span', { class: 'today-when' }, relTime(f.sentAt)), h('span', { class: 'chip' }, 'Waiting on'),
        h('span', { class: 'grow' }, h('strong', {}, f.to.email), ` · ${f.subject}`)));
    }
  }
  wrap.append(weekCard());
  return wrap;
}

export function itemsDueSoon(): number {
  const soon = Date.now() + 3 * 86_400_000;
  return ui.state.items.filter((i) => i.status === 'open' && i.at !== undefined && i.at <= soon).length;
}

export function dueCount(): number {
  const now = Date.now();
  return (
    ui.state.owed.filter((o) => o.overdue).length +
    ui.state.followUps.filter((f) => f.status === 'waiting' && f.dueAt <= now).length +
    ui.state.commitments.filter((c) => c.status === 'open' && c.dueAt && c.dueAt <= now).length +
    ui.state.reminders.filter((r) => r.status === 'due').length
  );
}
