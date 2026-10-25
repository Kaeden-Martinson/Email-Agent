import type { Commitment, FollowUp, OwedReply, Reminder, ReminderTarget } from '../../shared/types.js';
import { api, btn, go, h, relTime, render, run, ui, valueOf } from '../core.js';

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

export function renderFollowUps(): HTMLElement {
  const wrap = h('div');
  const now = Date.now();
  const waiting = ui.state.followUps.filter((f) => f.status === 'waiting');
  const commitments = ui.state.commitments.filter((c) => c.status === 'open');
  const dueReminders = ui.state.reminders.filter((r) => r.status === 'due');
  const pending = ui.state.reminders.filter((r) => r.status === 'pending');
  const resolved = [
    ...ui.state.followUps.filter((f) => f.status === 'replied').map((f) => ({ at: f.repliedAt ?? f.sentAt, text: `${f.to.email} replied to "${f.subject}"` })),
    ...ui.state.reminders.filter((r) => r.status === 'resolved').map((r) => ({ at: r.at, text: `Skipped reminder "${r.title}": ${r.note}` })),
  ].sort((a, b) => b.at - a.at);

  wrap.append(h('p', { class: 'hint' },
    `Pilot reads your sent mail for questions you're waiting on and promises you made, and checks the real conversation for replies before anything shows as overdue. Nudge after ${ui.state.settings.followUpDays} working days (change in Settings).`));

  if (dueReminders.length) {
    wrap.append(h('h3', { class: 'section' }, `Reminders due (${dueReminders.length})`));
    for (const r of dueReminders) wrap.append(reminderRow(r));
  }

  const owed = ui.state.owed;
  wrap.append(h('h3', { class: 'section' }, `You owe a reply (${owed.length})`));
  if (!owed.length) wrap.append(h('div', { class: 'empty small' }, 'Nobody is waiting on you.'));
  for (const o of owed) wrap.append(owedRow(o));

  wrap.append(h('h3', { class: 'section' }, `Waiting on them (${waiting.length})`));
  if (!waiting.length) wrap.append(h('div', { class: 'empty small' }, "You're not waiting on anyone. Emails you send that ask something show up here."));
  for (const f of waiting.sort((a, b) => a.dueAt - b.dueAt)) wrap.append(followUpRow(f, now));

  wrap.append(h('h3', { class: 'section' }, `Your commitments (${commitments.length})`));
  if (!commitments.length) wrap.append(h('div', { class: 'empty small' }, 'No open promises. "I\'ll send it Friday" in your mail shows up here.'));
  for (const c of commitments.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))) wrap.append(commitmentRow(c, now));

  if (pending.length) {
    wrap.append(h('h3', { class: 'section' }, `Scheduled reminders (${pending.length})`));
    for (const r of pending.sort((a, b) => a.at - b.at)) wrap.append(reminderRow(r));
  }

  if (resolved.length) {
    wrap.append(h('details', { class: 'group' }, h('summary', {}, `Resolved automatically (${resolved.length})`),
      resolved.slice(0, 30).map((x) => h('div', { class: 'hint resolved' }, `${relTime(x.at)} · ${x.text}`))));
  }
  return wrap;
}

function owedRow(o: OwedReply): HTMLElement {
  return h('div', { class: `banner fu-row ${o.overdue ? 'overdue' : ''}` },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, o.from.name || o.from.email), ` · ${o.subject || '(no subject)'}`,
        o.overdue ? h('span', { class: 'pill bad' }, 'Overdue') : null),
      h('div', { class: 'hint' }, `Received ${relTime(o.receivedAt)}`),
      o.openQuestions.length ? h('div', { class: 'thread-facts' }, h('strong', {}, 'Still open: '), o.openQuestions.join(' · ')) : null,
      ui.remindFor === `u:${o.key}` ? remindBox({ kind: 'update', key: o.key }) : null),
    h('div', { class: 'row' },
      btn('Reply', () => { ui.tab = 'open'; go('updates'); }),
      btn('Remind me…', () => openRemind(`u:${o.key}`)),
      btn('Done', () => void run(() => api.act(o.key, 'done')), 'ghost')));
}

function followUpRow(f: FollowUp, now: number): HTMLElement {
  const due = f.dueAt <= now;
  return h('div', { class: `banner fu-row ${due ? 'overdue' : ''}` },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, f.to.email), ` · ${f.subject || '(no subject)'}`,
        due ? h('span', { class: 'pill bad' }, 'Time to follow up') : null),
      h('div', { class: 'hint' }, `You asked: "${f.asked}"`),
      h('div', { class: 'hint' }, `Sent ${relTime(f.sentAt)} · ${due ? 'no reply yet' : `nudge ${dayLabel(f.dueAt)}`} (${f.dueReason})`),
      ui.remindFor === `f:${f.id}` ? remindBox({ kind: 'followup', id: f.id }) : null),
    h('div', { class: 'row' },
      btn('Draft a nudge', () => void run(() => api.draftNudge(f.id), 'Follow-up saved as a draft in your mailbox. Review and send it from there.'), due ? 'primary' : ''),
      btn('Remind me…', () => openRemind(`f:${f.id}`)),
      btn('Got it', () => void run(() => api.setFollowUp(f.id, 'done'))),
      btn('Not needed', () => void run(() => api.setFollowUp(f.id, 'dismissed')), 'ghost')));
}

function commitmentRow(c: Commitment, now: number): HTMLElement {
  const due = !!c.dueAt && c.dueAt <= now;
  return h('div', { class: `banner fu-row ${due ? 'overdue' : ''}` },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, c.text), due ? h('span', { class: 'pill bad' }, 'Due') : null),
      h('div', { class: 'hint' },
        `${c.source === 'sent' ? 'From your email' : 'From the conversation'} "${c.subject}"${c.withWhom ? ` with ${c.withWhom}` : ''} · ${relTime(c.at)}` +
          (c.dueAt ? ` · due ${dayLabel(c.dueAt)}` : '')),
      ui.remindFor === `c:${c.id}` ? remindBox({ kind: 'commitment', id: c.id }) : null),
    h('div', { class: 'row' },
      btn('Done', () => void run(() => api.setCommitment(c.id, 'done')), 'primary'),
      btn('Remind me…', () => openRemind(`c:${c.id}`)),
      btn('Not a promise', () => void run(() => api.setCommitment(c.id, 'dismissed')), 'ghost')));
}

function reminderRow(r: Reminder): HTMLElement {
  return h('div', { class: `banner fu-row ${r.status === 'due' ? 'overdue' : ''}` },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, r.title)),
      h('div', { class: 'hint' },
        `${r.status === 'due' ? 'Due' : 'Scheduled'} ${dayLabel(r.at)} at ${new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` +
          ` · "${r.phrase}"${r.unlessReplied ? ' · skipped if a reply arrives first' : ''}`)),
    btn(r.status === 'due' ? 'Done' : 'Cancel', () => void run(() => api.cancelReminder(r.id)), r.status === 'due' ? 'primary' : 'ghost'));
}
