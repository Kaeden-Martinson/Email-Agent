import { api, go, h, relTime, run, ui, CAT_LABEL, type View } from '../core.js';
import { icon, type IconName } from '../icons.js';
import { banner, button, card, chip, emptyState, listRow, sectionTitle, stats } from '../ui.js';
import { aiSetupPanel, aiStatus } from './aisetup.js';
import { deadlineOf, fmtMoney, KIND_LABEL } from './deadlines.js';

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
  icon: IconName;
  amount?: string;
  overdue: boolean;
  go: View;
}

/** Everything with a date in the next 7 days, plus anything overdue, on one timeline. */
function agenda(): Agenda[] {
  const now = Date.now();
  const until = now + 7 * 86_400_000;
  const out: Agenda[] = [];
  for (const i of ui.state.items.filter((x) => x.status === 'open' && x.at !== undefined && x.at <= until)) {
    out.push({ at: i.at!, allDay: i.allDay, label: KIND_LABEL[i.kind], title: i.title, amount: i.amount !== undefined ? fmtMoney(i) : undefined, icon: i.kind === 'bill' ? 'bill' : 'calendar', detail: i.sender, overdue: deadlineOf(i) < now, go: 'deadlines' });
  }
  for (const c of ui.state.commitments.filter((x) => x.status === 'open' && x.dueAt && x.dueAt <= until)) {
    out.push({ at: c.dueAt!, allDay: false, label: 'You promised', icon: 'reply', title: c.text, detail: c.withWhom ?? '', overdue: c.dueAt! < now, go: 'followups' });
  }
  for (const f of ui.state.followUps.filter((x) => x.status === 'waiting' && x.dueAt <= until)) {
    out.push({ at: f.dueAt, allDay: false, label: 'Follow up', icon: 'reply', title: f.subject || '(no subject)', detail: f.to.email, overdue: f.dueAt < now, go: 'followups' });
  }
  for (const r of ui.state.reminders.filter((x) => (x.status === 'pending' && x.at <= until) || x.status === 'due')) {
    out.push({ at: r.at, allDay: false, label: 'Reminder', icon: 'clock', title: r.title, detail: `"${r.phrase}"`, overdue: r.status === 'due', go: 'followups' });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.at - b.at);
}

function agendaList(): HTMLElement {
  const items = agenda();
  if (!items.length) return emptyState('Nothing scheduled. Bills, deadlines, appointments, promises and follow-ups will appear here.');
  return h('div', { class: 'g-list' }, items.map((a) => {
    const d = new Date(a.at);
    const date = h('span', { style: 'display:inline-block;min-width:44px;color:var(--muted);font-size:11px;line-height:1.3;font-variant-numeric:tabular-nums;font-weight:500' },
      d.toLocaleDateString(undefined, { weekday: 'short' }), h('br', {}), d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    return listRow({
      dot: null,
      title: [date, icon(a.icon, 14), h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0' }, a.title), a.overdue ? chip('Overdue', 'warn') : null],
      sub: a.detail ? h('span', { style: 'padding-left:68px' }, a.detail) : undefined,
      right: a.amount ?? null,
      onClick: () => go(a.go),
    });
  }));
}

function waitingList(): HTMLElement {
  const now = Date.now();
  const waiting = ui.state.followUps.filter((f) => f.status === 'waiting');
  const owed = ui.state.owed.slice(0, 3);
  if (!waiting.length && !owed.length) return emptyState('No conversations pending.');
  const rows = [
    ...owed.map((o) => listRow({
      dot: null,
      title: [o.from.name || o.from.email, chip('You owe', 'accent')],
      sub: o.subject,
      right: relTime(o.receivedAt),
      onClick: () => go('followups'),
    })),
    ...waiting.map((f) => {
      const days = Math.max(0, Math.floor((now - f.sentAt) / 86_400_000));
      return listRow({
        dot: null,
        title: [f.to.name || f.to.email, f.dueAt <= now ? chip('Overdue', 'warn') : null],
        sub: f.subject || '(no subject)',
        right: `${days}d`,
        onClick: () => go('followups'),
      });
    }),
  ];
  return h('div', { class: 'g-list' }, rows);
}

export function renderToday(): HTMLElement {
  const s = ui.state;
  const wrap = h('div', {});
  for (const a of s.accounts.filter((x) => x.needsReconnect && x.kind !== 'imap')) {
    wrap.append(banner('warn', [h('strong', {}, `${a.email} needs to be reconnected. `), 'The sign-in expired (Google does this weekly while the app is in Testing). Your data is kept.'],
      [button('Reconnect', { kind: 'primary', onClick: () => void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: a.calendar }), 'Reconnected. Checking mail…') })]));
  }
  const up = s.app.update;
  if (up?.available && up.url) wrap.append(banner('info', [h('strong', {}, `Pilot ${up.latest} is available. `), `You have ${s.app.version}.`], [button('Download', { kind: 'primary', icon: 'download', onClick: () => void run(() => api.openUrl(up.url!)) })]));
  if (s.status.ollamaOk === false || (aiStatus && !aiStatus.ready)) wrap.append(h('div', { style: 'margin-bottom:12px' }, aiSetupPanel()));
  if (!s.accounts.some((a) => a.watching)) {
    wrap.append(emptyState("Pilot isn't watching any mailbox yet.", button('Go to Mailboxes', { kind: 'primary', onClick: () => go('mailboxes') })));
    return wrap;
  }
  const b = s.briefing;
  if (b && new Date(b.at).toDateString() === new Date().toDateString()) {
    wrap.append(card([h('div', { class: 'g-sec', style: 'color:var(--accent-text)' }, icon('spark', 13), `Briefing · ${relTime(b.at)}`), h('p', { style: 'margin:0;max-width:72ch' }, b.text)]), h('div', { style: 'height:12px' }));
  }
  const open = s.updates.filter((u) => u.status === 'new');
  const needYou = open.filter((u) => u.triage?.priority === 1 || (u.triage?.needsReply && !u.triage.repliedAlready)).slice(0, 6);
  const w = s.weekly;
  const left = h('div', {},
    sectionTitle('Needs you', needYou.length),
    needYou.length
      ? h('div', { class: 'g-list' }, needYou.map((u) => listRow({
          dot: u.triage?.priority === 1 ? 'p1' : 'p2',
          title: [u.message.from.name || u.message.from.email, u.triage ? chip(CAT_LABEL[u.triage.category]) : null],
          sub: h('span', {}, h('span', { style: 'color:var(--text)' }, u.message.subject || '(no subject)'), u.triage ? ` · ${u.triage.summary}` : ''),
          right: relTime(u.message.receivedAt),
          onClick: () => { ui.selectedKey = u.key; go('updates'); },
        })))
      : emptyState("Nothing needs you right now."),
    sectionTitle('Your week'),
    stats([{ value: String(w.received), label: 'emails' }, { value: String(w.important), label: 'important' }, { value: String(w.owed), label: 'you owe' },
      { value: w.billTotal !== undefined && w.currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency: w.currency, maximumFractionDigits: 0 }).format(w.billTotal) : String(w.bills), label: w.billTotal !== undefined ? 'due in 2 weeks' : 'bills soon' }]),
    w.noisiest.length ? h('div', { class: 'g-hint', style: 'margin-top:6px' }, `Noisiest: ${w.noisiest.map((n) => `${n.name} (${n.count})`).join(', ')} `, button('Clean up', { tiny: true, kind: 'ghost', onClick: () => go('subscriptions') })) : null);
  const right = h('div', {}, sectionTitle('Coming up'), agendaList(), sectionTitle('Waiting on'), waitingList());
  wrap.append(h('div', { class: 'g-grid2' }, left, right));
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
