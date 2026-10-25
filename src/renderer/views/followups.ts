import type { Commitment, FollowUp, OwedReply, Reminder, ReminderTarget } from '../../shared/types.js';
import { api, btn, go, h, relTime, render, run, ui, valueOf } from '../core.js';
import { button, chip, emptyState, listRow, sectionTitle } from '../ui.js';

// ---- follow-ups ----

export function openRemind(id: string): void {
  ui.remindFor = ui.remindFor === id ? null : id;
  ui.remindText = '';
  ui.remindPreview = '';
  render();
  document.querySelector<HTMLInputElement>('.remind-box input')?.focus();
}

/** Natural-language reminder input with a live preview of how Pilot read it. */
export function remindBox(target: ReminderTarget): HTMLElement {
  const preview = h('div', { class: 'hint remind-preview' }, ui.remindPreview || 'Try "Friday", "tomorrow at 3pm", "in 2 days" or "Monday if they haven\'t replied".');
  let timer: number | undefined;
  const input = h('input', {
    type: 'text',
    value: ui.remindText,
    placeholder: 'Remind me…',
    oninput: (e: Event) => {
      ui.remindText = valueOf(e);
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!ui.remindText.trim()) return;
        const r = await api.previewWhen(ui.remindText);
        ui.remindPreview = 'error' in r ? r.error : `Pilot will remind you ${r.label}.`;
        preview.textContent = ui.remindPreview;
        preview.classList.toggle('err', 'error' in r);
      }, 250);
    },
  });
  return h('form', { class: 'remind-box', onsubmit: (e: Event) => {
    e.preventDefault();
    void run(async () => {
      await api.remind(target, ui.remindText);
      ui.remindFor = null;
      render();
    }, 'Reminder set');
  } },
    h('div', { class: 'row' }, input,
      h('button', { class: 'btn primary', type: 'submit' }, 'Set reminder'),
      btn('Cancel', () => { ui.remindFor = null; render(); }, 'ghost')),
    preview);
}

const dayLabel = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

let selectedFu: string | null = null;

/** Inline cluster of row buttons; clicks never reach the row's own handler. */
function acts(...kids: (Node | null)[]): HTMLElement {
  const box = h('span', { class: 'g-acts' }, ...kids);
  box.addEventListener('click', (e) => e.stopPropagation());
  return box;
}

export function renderFollowUps(): HTMLElement {
  const now = Date.now();
  const waiting = ui.state.followUps.filter((f) => f.status === 'waiting').sort((a, b) => a.dueAt - b.dueAt);
  const commitments = ui.state.commitments.filter((c) => c.status === 'open').sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  const reminders = ui.state.reminders.filter((r) => r.status === 'due' || r.status === 'pending')
    .sort((a, b) => (a.status === b.status ? a.at - b.at : a.status === 'due' ? -1 : 1));
  const owed = ui.state.owed;
  const resolved = [
    ...ui.state.followUps.filter((f) => f.status === 'replied').map((f) => ({ at: f.repliedAt ?? f.sentAt, text: `${f.to.email} replied to "${f.subject}"` })),
    ...ui.state.reminders.filter((r) => r.status === 'resolved').map((r) => ({ at: r.at, text: `Skipped reminder "${r.title}": ${r.note}` })),
  ].sort((a, b) => b.at - a.at);

  const left = h('div', {},
    sectionTitle('Waiting on them', waiting.length),
    waiting.length
      ? h('div', { class: 'g-list' }, waiting.map((f) => followUpRow(f, now)))
      : emptyState('Nobody owes you a reply. Emails you send that ask something show up here.'));

  const right = h('div', {},
    sectionTitle('You owe', owed.length),
    owed.length ? h('div', { class: 'g-list' }, owed.map(owedRow)) : emptyState('Nobody is waiting on you.'),
    sectionTitle('You promised', commitments.length),
    commitments.length ? h('div', { class: 'g-list' }, commitments.map((c) => commitmentRow(c, now))) : emptyState('No open promises. "I\'ll send it Friday" in your mail shows up here.'),
    sectionTitle('Reminders', reminders.length),
    reminders.length ? h('div', { class: 'g-list' }, reminders.map(reminderRow)) : emptyState('No reminders set.'));

  return h('div', {},
    h('p', { class: 'hint' }, `Pilot reads your sent mail for questions you're waiting on and promises you made, and checks the real conversation for replies before anything shows as overdue. Nudge after ${ui.state.settings.followUpDays} working days (change in Settings).`),
    h('div', { class: 'g-grid2 eq' }, left, right),
    resolved.length
      ? h('details', { class: 'group' }, h('summary', {}, `Resolved automatically (${resolved.length})`),
        resolved.slice(0, 30).map((x) => h('div', { class: 'hint resolved' }, `${relTime(x.at)} · ${x.text}`)))
      : null);
}

function owedRow(o: OwedReply): HTMLElement {
  const rid = `u:${o.key}`;
  return h('div', {},
    listRow({
      dot: o.overdue ? 'p1' : 'low',
      title: [h('strong', {}, o.from.name || o.from.email), ` · ${o.subject || '(no subject)'}`],
      sub: [`Received ${relTime(o.receivedAt)}${o.openQuestions.length ? ` · Still open: ${o.openQuestions.join(' · ')}` : ''}`,
        acts(button('Remind me', { onClick: () => openRemind(rid), icon: 'clock', kind: 'ghost', tiny: true }),
          button('Done', { onClick: () => void run(() => api.act(o.key, 'done')), icon: 'check', kind: 'ghost', tiny: true }))],
      right: o.overdue ? chip('Overdue', 'danger') : null,
      onClick: () => { ui.selectedKey = o.key; ui.tab = 'open'; go('updates'); },
      key: o.key,
    }),
    ui.remindFor === rid ? remindBox({ kind: 'update', key: o.key }) : null);
}

function followUpRow(f: FollowUp, now: number): HTMLElement {
  const due = f.dueAt <= now;
  const rid = `f:${f.id}`;
  const open = due || selectedFu === f.id || ui.remindFor === rid;
  return h('div', {},
    listRow({
      dot: 'low',
      title: f.to.email,
      sub: `${f.subject || '(no subject)'} · sent ${relTime(f.sentAt)} · ${due ? 'no reply yet' : `nudge ${dayLabel(f.dueAt)}`}`,
      right: due ? chip('Time to follow up', 'warn') : chip(`nudge ${dayLabel(f.dueAt)}`),
      selected: selectedFu === f.id,
      onClick: () => { selectedFu = selectedFu === f.id ? null : f.id; render(); },
    }),
    open ? h('div', { class: 'g-acts', style: 'padding:6px 12px 10px;flex-wrap:wrap' },
      h('div', { class: 'hint', style: 'flex-basis:100%' }, `You asked: "${f.asked}" (${f.dueReason})`),
      button('Draft a nudge', { icon: 'pen', kind: due ? 'primary' : 'default', onClick: () => void run(() => api.draftNudge(f.id), 'Follow-up saved as a draft in your mailbox. Review and send it from there.') }),
      button('Remind me', { icon: 'clock', onClick: () => openRemind(rid) }),
      button('Mark done', { icon: 'check', onClick: () => void run(() => api.setFollowUp(f.id, 'done')) }),
      button('Not needed', { kind: 'ghost', onClick: () => void run(() => api.setFollowUp(f.id, 'dismissed')) })) : null,
    ui.remindFor === rid ? remindBox({ kind: 'followup', id: f.id }) : null);
}

function commitmentRow(c: Commitment, now: number): HTMLElement {
  const due = !!c.dueAt && c.dueAt <= now;
  return h('div', {},
    listRow({
      dot: due ? 'p1' : 'low',
      title: c.text,
      sub: [`${c.source === 'sent' ? 'From your email' : 'From the conversation'} "${c.subject}"${c.withWhom ? ` with ${c.withWhom}` : ''} · ${relTime(c.at)}${c.dueAt ? ` · due ${dayLabel(c.dueAt)}` : ''}`,
        acts(
        button('Done', { onClick: () => void run(() => api.setCommitment(c.id, 'done')), icon: 'check', kind: 'primary', tiny: true }),
        button('Remind me', { onClick: () => openRemind(`c:${c.id}`), icon: 'clock', kind: 'ghost', tiny: true }),
        button('Dismiss', { onClick: () => void run(() => api.setCommitment(c.id, 'dismissed')), kind: 'ghost', tiny: true, title: 'Not a promise' }))],
      right: due ? chip('Due', 'danger') : null,
    }),
    ui.remindFor === `c:${c.id}` ? remindBox({ kind: 'commitment', id: c.id }) : null);
}

function reminderRow(r: Reminder): HTMLElement {
  const due = r.status === 'due';
  return listRow({
    dot: due ? 'p1' : 'low',
    title: r.title,
    sub: `${due ? 'Due' : 'Scheduled'} ${dayLabel(r.at)} at ${new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · "${r.phrase}"${r.unlessReplied ? ' · skipped if a reply arrives first' : ''}`,
    right: acts(due ? chip('Due', 'danger') : null,
      button(due ? 'Done' : 'Cancel', { onClick: () => void run(() => api.cancelReminder(r.id)), kind: due ? 'primary' : 'ghost', tiny: true })),
  });
}
