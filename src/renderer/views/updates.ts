import type { ActivityEntry, CorrectionKind, ReplyRecord, TriageSource, Update } from '../../shared/types.js';
import { cluster } from '../../shared/group.js';
import { accountOf, api, bodies, btn, CAT_LABEL, editors, go, h, keysOverlay, openReply, quickAct, relTime, render, run, showOriginal, showThread, toast, ui, valueOf } from '../core.js';
import { CONFIDENCE, fmtMoney, fmtWhen, KIND_LABEL } from './deadlines.js';
import { openRemind, remindBox } from './followups.js';

// ---- updates ----

export function renderUpdates(): HTMLElement {
  const wrap = h('div');
  const watching = ui.state.accounts.filter((a) => a.watching);
  if (!ui.state.accounts.length) {
    wrap.append(h('div', { class: 'banner' },
      h('strong', {}, 'Add a mailbox to get started. '),
      'Type your email address and Pilot sets up the rest.',
      h('div', { class: 'actions' }, btn('Add mailbox', () => { ui.addFlow = { email: '', busy: '', password: '' }; go('mailboxes'); }, 'primary'))));
  } else if (!watching.length) {
    wrap.append(h('div', { class: 'banner' },
      h('strong', {}, "Pilot isn't watching any mailbox yet. "),
      'Open Mailboxes, check the permissions, and press Start watching.',
      h('div', { class: 'actions' }, btn('Go to Mailboxes', () => go('mailboxes'), 'primary'))));
  }

  if (watching.length) wrap.append(renderBriefing());
  const waiting = ui.state.activity.filter((a) => a.status === 'proposed').length;
  if (waiting) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `${waiting} action${waiting === 1 ? '' : 's'} waiting for your approval. `),
      'Preview mode is on, so Pilot proposes automatic actions instead of doing them.',
      h('div', { class: 'actions' }, btn('Review in Activity', () => go('activity'), 'primary'))));
  }

  const open = ui.state.updates.filter((u) => u.status !== 'done');
  const done = ui.state.updates.filter((u) => u.status === 'done');
  const needYou = open.filter((u) => u.status === 'new' && u.triage?.priority === 1);
  const normal = open.filter((u) => u.status === 'new' && u.triage?.priority === 2);
  const low = open.filter((u) => u.status === 'new' && u.triage?.priority === 3);
  const unread = open.filter((u) => u.status === 'new' && !u.triage);
  const snoozed = open.filter((u) => u.status === 'snoozed');

  if (open.length) {
    const drafts = open.filter((u) => u.reply?.state === 'drafted').length;
    wrap.append(h('div', { class: 'banner' },
      `${needYou.length} need${needYou.length === 1 ? 's' : ''} you today · ${normal.length} worth a look · ${low.length} low priority`,
      drafts ? ` · ${drafts} reply draft${drafts === 1 ? '' : 's'} waiting in your mailbox` : ''));
  }

  wrap.append(h('div', { class: 'tabs' },
    h('button', { class: ui.tab === 'open' ? 'active' : '', onclick: () => { ui.tab = 'open'; render(); } }, `Open (${open.length})`),
    h('button', { class: ui.tab === 'done' ? 'active' : '', onclick: () => { ui.tab = 'done'; render(); } }, `Done (${done.length})`),
    h('button', { class: 'keys-hint', title: 'Keyboard shortcuts', onclick: () => { ui.showKeys = true; document.body.append(keysOverlay()); } }, 'Shortcuts: ?')));

  if (ui.tab === 'done') {
    wrap.append(done.length ? group('Done', done) : h('div', { class: 'empty' }, 'Nothing marked done yet.'));
    return wrap;
  }
  if (!open.length) {
    wrap.append(h('div', { class: 'empty' }, watching.length ? "You're all caught up." : ''));
    return wrap;
  }
  if (needYou.length) wrap.append(group('Needs you', needYou));
  if (normal.length) wrap.append(group('Worth a look', normal));
  if (unread.length) wrap.append(group('Not read yet', unread));
  if (snoozed.length) wrap.append(group('Snoozed', snoozed, true));
  if (low.length) wrap.append(group('Low priority', low, true));
  return wrap;
}

function group(title: string, items: Update[], collapsed = false): HTMLElement {
  const body = groupedCards(items);
  if (collapsed) return h('details', { class: 'group' }, h('summary', {}, `${title} (${items.length})`), body);
  return h('section', { class: 'group' }, h('h2', {}, title), body);
}

/** Repeats of the same alert or notification show as one card with "+N similar" under it. */
function groupedCards(items: Update[]): HTMLElement[] {
  const byKey = new Map(items.map((u) => [u.key, u]));
  const clusters = cluster(items.map((u) => ({ key: u.key, from: u.message.from.email, subject: u.message.subject, at: u.message.receivedAt })));
  // Keep the section's own order (by importance), placing each cluster where its newest email was.
  const order = new Map(items.map((u, i) => [u.key, i]));
  clusters.sort((a, b) => Math.min(...a.map((x) => order.get(x.key)!)) - Math.min(...b.map((x) => order.get(x.key)!)));
  return clusters.map((c) => {
    const [first, ...rest] = c.map((x) => byKey.get(x.key)!);
    if (!rest.length) return card(first);
    const open = [first, ...rest].filter((u) => u.status !== 'done');
    return h('div', { class: 'cluster' },
      card(first),
      h('details', { class: 'similar' },
        h('summary', {}, `+${rest.length} similar from ${first.message.from.name || first.message.from.email}`),
        rest.map(card),
        open.length > 1
          ? h('div', { class: 'actions' }, btn(`Mark all ${open.length} done`, () => void run(() => api.doneMany(open.map((u) => u.key)), `Marked ${open.length} done`)))
          : null));
  });
}

function replyLine(r: ReplyRecord): HTMLElement {
  const who = r.auto ? 'Pilot' : 'You';
  const what = {
    proposed: 'proposes a reply',
    drafted: 'saved a reply draft',
    sent: 'sent a reply',
    skipped: 'did not reply',
    failed: 'tried to reply but it failed',
  }[r.state];
  return h('div', { class: 'reply-state' }, h('strong', {}, `${who} ${what}`), ` ${relTime(r.at)}`, r.note ? ` · ${r.note}` : '');
}

function autoLine(u: Update): HTMLElement | null {
  const a = u.auto;
  if (!a || (!a.archived && !a.labeled && !a.error)) return null;
  const did = [a.labeled && 'labeled', a.archived && 'archived'].filter(Boolean).join(' and ');
  return h('div', { class: 'reply-state' },
    did ? h('strong', {}, `Pilot ${did} this automatically`) : null,
    a.error ? h('span', { class: 'err' }, `${did ? ' · ' : ''}${a.error}`) : null);
}

export function renderBriefing(): HTMLElement {
  const b = ui.state.briefing;
  const today = b && new Date(b.at).toDateString() === new Date().toDateString();
  const again = btn(today ? 'Brief me again' : 'Brief me now', () => void run(() => api.briefNow()), 'ghost');
  if (!today) {
    return h('div', { class: 'banner briefing' },
      h('div', { class: 'briefing-head' }, h('strong', {}, "Today's briefing"), again),
      h('p', { class: 'hint' },
        ui.state.settings.briefing.enabled
          ? `Your Pilot briefs you every morning at ${ui.state.settings.briefing.time}.`
          : 'Morning briefings are off. Turn them on in Settings.'));
  }
  return h('div', { class: 'banner briefing' },
    h('div', { class: 'briefing-head' }, h('strong', {}, "Today's briefing"), h('span', { class: 'hint' }, relTime(b.at)), again),
    h('p', {}, b.text));
}

let snoozeText = '';

function snoozeBox(u: Update): HTMLElement {
  const go = (choice: string) =>
    void run(async () => {
      const label = await api.snooze(u.key, choice);
      ui.snoozeFor = null;
      toast(label, { label: 'Undo', fn: () => void run(() => api.act(u.key, 'reopen'), 'Undone') });
    });
  const preview = h('div', { class: 'hint' }, 'Or type a time: "Friday 3pm", "in 3 days", "Monday if they haven\'t replied".');
  let timer: number | undefined;
  const input = h('input', {
    type: 'text',
    value: snoozeText,
    placeholder: 'Snooze until…',
    oninput: (e: Event) => {
      snoozeText = valueOf(e);
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!snoozeText.trim()) return;
        const r = await api.previewSnooze(snoozeText);
        preview.textContent = 'error' in r ? r.error : `Snooze ${r.label}.`;
        preview.classList.toggle('err', 'error' in r);
      }, 250);
    },
  });
  return h('form', { class: 'remind-box', onsubmit: (e: Event) => { e.preventDefault(); if (snoozeText.trim()) go(snoozeText); } },
    h('div', { class: 'row' },
      btn('Tomorrow', () => go('tomorrow')),
      btn('Next week', () => go('nextweek')),
      btn('Until they reply', () => go('reply')),
      btn('Cancel', () => { ui.snoozeFor = null; render(); }, 'ghost')),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Snooze')),
    preview);
}

function card(u: Update): HTMLElement {
  const m = u.message;
  const t = u.triage;
  const account = accountOf(u);
  const isOpen = u.status !== 'done';
  const canOpen = !!(m.webLink || account?.webmailUrl);

  const openEditor = () => openReply(u);

  const actions = isOpen
    ? [
        btn('Done', () => quickAct(u, 'done')),
        account?.permissions.manage ? btn('Archive', () => quickAct(u, 'archive')) : null,
        u.status === 'new'
          ? btn('Snooze…', () => { ui.snoozeFor = ui.snoozeFor === u.key ? null : u.key; snoozeText = ''; render(); })
          : btn('Unsnooze', () => void run(() => api.act(u.key, 'reopen'))),
        editors.has(u.key) ? null : btn(t?.draftReply ? 'Review reply' : 'Reply', openEditor),
        t?.needsReply && !t.repliedAlready ? btn('Remind me…', () => openRemind(`u:${u.key}`)) : null,
        canOpen ? btn('Open in mail', () => void run(() => api.open(u.key)), 'ghost') : null,
        u.thread?.length
          ? btn(showThread.has(u.key) ? 'Hide conversation' : `Conversation (${u.thread.length})`, () => {
              if (!showThread.delete(u.key)) showThread.add(u.key);
              render();
            }, 'ghost')
          : null,
        btn(showOriginal.has(u.key) ? 'Hide email' : 'Show email', () => {
          if (!showOriginal.delete(u.key)) {
            showOriginal.add(u.key);
            if (!bodies.has(u.key)) {
              void api.getBody(u.key).then((b) => {
                bodies.set(u.key, b || m.snippet || '(empty)');
                render();
              });
            }
          }
          render();
        }, 'ghost'),
        btn('Re-read', () => void run(() => api.redraft(u.key), 'Summary refreshed'), 'ghost'),
      ]
    : [
        btn('Move back to open', () => void run(() => api.act(u.key, 'reopen'))),
        canOpen ? btn('Open in mail', () => void run(() => api.open(u.key)), 'ghost') : null,
      ];

  return h('article', { class: `card p${t?.priority ?? 0} ${isOpen ? '' : 'done'} ${ui.selectedKey === u.key ? 'selected' : ''}`, 'data-key': u.key },
    h('div', { class: 'card-head' },
      h('span', { class: 'from', title: m.from.email }, m.from.name || m.from.email || 'Unknown sender'),
      t ? h('span', { class: `chip c-${t.category}` }, CAT_LABEL[t.category]) : null,
      h('span', { class: 'meta' }, `${relTime(m.receivedAt)}${ui.state.accounts.length > 1 && account ? ` · ${account.email}` : ''}`)),
    h('div', { class: 'subject' }, m.subject || '(no subject)'),
    h('p', { class: 'summary' }, t ? t.summary : u.triageError ? `Couldn't summarize this one: ${u.triageError}` : m.snippet),
    m.attachmentNames?.length ? h('div', { class: 'hint' }, `Read the attached ${m.attachmentNames.join(', ')}`) : null,
    t?.actionItems.length ? h('ul', { class: 'todos' }, t.actionItems.map((a) => h('li', {}, a))) : null,
    t?.openQuestions?.length && !t.repliedAlready
      ? h('div', { class: 'thread-facts' }, h('strong', {}, 'Still waiting on you: '), t.openQuestions.join(' · '))
      : null,
    t?.userPromises?.length ? h('div', { class: 'thread-facts' }, h('strong', {}, 'You promised: '), t.userPromises.join(' · ')) : null,
    keyDates(u),
    t ? whyLine(u) : null,
    u.reply ? replyLine(u.reply) : null,
    autoLine(u),
    proposalsFor(u),
    showThread.has(u.key) && u.thread ? conversation(u) : null,
    showOriginal.has(u.key) ? h('pre', { class: 'original' }, bodies.get(u.key) ?? 'Loading…') : null,
    editors.has(u.key) ? replyEditor(u) : null,
    ui.remindFor === `u:${u.key}` ? remindBox({ kind: 'update', key: u.key }) : null,
    ui.snoozeFor === u.key ? snoozeBox(u) : null,
    u.status === 'snoozed' && u.snoozeUntil
      ? h('div', { class: 'hint' }, u.snoozeUntilReply ? `Snoozed until they reply (at the latest ${new Date(u.snoozeUntil).toLocaleDateString()})` : `Snoozed until ${new Date(u.snoozeUntil).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      : null,
    h('div', { class: 'actions' }, actions),
    t && isOpen ? correctionBar(u) : null);
}

/** The messages behind a summary: quoted history stripped, the ones the AI relied on highlighted. */
function conversation(u: Update): HTMLElement {
  const used = new Set(u.triage?.sources ?? []);
  return h('div', { class: 'conversation' },
    h('div', { class: 'hint' }, used.size ? 'Highlighted messages are the ones the summary is based on.' : 'Quoted history is hidden.'),
    u.thread!.map((msg, i) =>
      h('div', { class: `thread-msg ${msg.fromMe ? 'me' : ''} ${used.has(i + 1) ? 'used' : ''}` },
        h('div', { class: 'thread-head' },
          h('strong', {}, `[${i + 1}] ${msg.fromMe ? 'You' : msg.from.name || msg.from.email}`),
          h('span', { class: 'hint' }, ` · ${new Date(msg.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
          used.has(i + 1) ? h('span', { class: 'chip' }, 'used for summary') : null),
        h('div', { class: 'thread-text' }, msg.text))));
}

export const SOURCE_LABEL: Record<TriageSource, string> = {
  rule: 'your rule',
  fast: 'rules (no AI)',
  light: 'quick AI read',
  full: 'full AI read',
};

/** Explainability: why this priority, from which stage, how long it took. */
function whyLine(u: Update): HTMLElement {
  const t = u.triage!;
  const bits = [t.reason, t.source ? `via ${SOURCE_LABEL[t.source]}` : '', t.ms != null && t.source !== 'fast' && t.source !== 'rule' ? `${(t.ms / 1000).toFixed(1)}s` : '']
    .filter(Boolean)
    .join(' · ');
  return bits ? h('div', { class: 'why' }, `Why: ${bits}`) : h('div');
}

function correctionBar(u: Update): HTMLElement {
  const fix = (kind: CorrectionKind, scope: 'once' | 'sender' | 'domain', done: string) =>
    void run(() => api.correct(u.key, kind, scope), done);
  const sender = u.message.from.email;
  const domain = sender.split('@')[1] ?? '';
  const always = h('select', {
    class: 'always',
    onchange: (e: Event) => {
      const [kind, scope] = (e.target as HTMLSelectElement).value.split(':') as [CorrectionKind, 'sender' | 'domain'];
      (e.target as HTMLSelectElement).value = '';
      if (kind) fix(kind, scope, 'Rule created. It applies to new and existing mail.');
    },
  },
    h('option', { value: '' }, 'Always from this sender…'),
    h('option', { value: 'more:sender' }, `Important: ${sender}`),
    h('option', { value: 'less:sender' }, `Low priority: ${sender}`),
    h('option', { value: 'junk:sender' }, `Hide: ${sender}`),
    h('option', { value: 'more:domain' }, `Important: anyone @${domain}`),
    h('option', { value: 'less:domain' }, `Low priority: anyone @${domain}`));
  return h('div', { class: 'correct' },
    h('span', { class: 'hint' }, 'Teach Pilot:'),
    btn('More important', () => fix('more', 'once', 'Got it. Only this email changes.'), 'tiny'),
    btn('Less important', () => fix('less', 'once', 'Got it. Only this email changes.'), 'tiny'),
    btn('Junk', () => fix('junk', 'once', 'Moved to Done. Only this email changes.'), 'tiny'),
    always);
}

export const ACTION_LABEL: Record<ActivityEntry['action'], string> = {
  archive: 'Archive',
  label: 'Label',
  draft: 'Save a reply draft',
  send: 'Send a reply',
  unsubscribe: 'Unsubscribe',
};

function proposalsFor(u: Update): HTMLElement | null {
  const items = ui.state.activity.filter((a) => a.key === u.key && a.status === 'proposed');
  if (!items.length) return null;
  return h('div', { class: 'proposals' }, items.map((a) =>
    h('div', { class: 'proposal' },
      h('span', {}, h('strong', {}, `Pilot proposes: ${ACTION_LABEL[a.action]}${a.category ? ` as ${CAT_LABEL[a.category]}` : ''}`), ` · ${a.reason}`),
      btn(a.action === 'send' ? 'Approve and send' : 'Approve', () => void run(() => api.approve(a.id), 'Done'), 'primary tiny'),
      btn('Reject', () => void run(() => api.reject(a.id)), 'tiny'))));
}

function keyDates(u: Update): HTMLElement | null {
  const items = ui.state.items.filter((i) => i.status === 'open' && i.sourceKeys.includes(u.key));
  if (!items.length) return null;
  return h('div', { class: 'key-dates' }, items.map((i) =>
    h('span', { class: `key-chip c-${i.confidence}`, title: i.notes.join(' ') || CONFIDENCE[i.confidence][0] },
      `${KIND_LABEL[i.kind]}: ${i.title} · ${fmtWhen(i)}${i.amount !== undefined ? ` · ${fmtMoney(i)}` : ''}`)));
}

/** Reply alternatives per email: undefined = not asked, 'loading', or the options. */
const replyAlts = new Map<string, 'loading' | { tone: string; text: string }[]>();

function replyEditor(u: Update): HTMLElement {
  const to = u.message.replyTo ?? u.message.from;
  const sig = accountOf(u)?.permissions.signature.trim();
  const alts = replyAlts.get(u.key);
  const useAlt = (text: string) => {
    editors.set(u.key, text + (sig ? `\n\n${sig}` : ''));
    render();
  };
  const altRow = h('div', { class: 'alts' },
    h('span', { class: 'hint' }, 'Other versions:'),
    alts === undefined
      ? btn('Suggest 3 versions', () => {
          replyAlts.set(u.key, 'loading');
          render();
          void run(async () => {
            try {
              replyAlts.set(u.key, await api.replyOptions(u.key));
            } catch (e) {
              replyAlts.delete(u.key);
              throw e;
            } finally {
              render();
            }
          });
        }, 'tiny')
      : alts === 'loading'
        ? h('span', { class: 'hint' }, 'Writing three versions on your PC…')
        : alts.map((o) => btn(o.tone, () => useAlt(o.text), 'tiny')));
  const ta = h('textarea', {
    id: `reply-${u.key}`,
    rows: 7,
    value: editors.get(u.key) ?? '',
    oninput: (e: Event) => editors.set(u.key, valueOf(e)),
  });
  const finish = (send: boolean) =>
    void run(async () => {
      await api.sendReply(u.key, editors.get(u.key) ?? '', send);
      editors.delete(u.key);
      render();
    }, send ? 'Reply sent' : 'Draft saved to your mailbox');
  const insertTimes = () =>
    void run(async () => {
      const times = await api.freeTimes(u.key);
      const current = editors.get(u.key) ?? '';
      const block = `I'm free at any of these times:\n${times.map((t) => `- ${t}`).join('\n')}`;
      // Above the signature, if there is one.
      const at = sig && current.endsWith(sig) ? current.length - sig.length : current.length;
      editors.set(u.key, `${current.slice(0, at).trimEnd()}\n\n${block}\n\n${current.slice(at)}`.trim());
      render();
    });
  return h('div', { class: 'editor' },
    h('div', { class: 'hint' }, `Reply to ${to.name ? `${to.name} <${to.email}>` : to.email}`),
    altRow,
    accountOf(u)?.calendar ? h('div', { class: 'alts' }, h('span', { class: 'hint' }, 'Calendar:'), btn('Insert my free times', insertTimes, 'tiny')) : null,
    ta,
    h('div', { class: 'actions' },
      btn('Send', () => finish(true), 'primary'),
      btn('Save as draft', () => finish(false)),
      btn('Cancel', () => { editors.delete(u.key); render(); }, 'ghost')));
}
