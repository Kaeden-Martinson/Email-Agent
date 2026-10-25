import type { ActivityEntry, AppState, CorrectionKind, ReplyRecord, TriageSource, Update } from '../../shared/types.js';
import { cluster } from '../../shared/group.js';
import { accountOf, api, bodies, btn, CAT_LABEL, editors, go, h, keysOverlay, openReply, quickAct, relTime, render, run, showOriginal, showThread, toast, ui, valueOf } from '../core.js';
import { banner, button, chip, emptyState, listRow, sectionTitle, tabs } from '../ui.js';
import { CONFIDENCE, fmtMoney, fmtWhen, KIND_LABEL } from './deadlines.js';
import { openRemind, remindBox } from './followups.js';

// ---- updates ----

/** Each list row's cluster of similar emails (newest first), by the row's key. Filled while the list renders. */
const clusterOf = new Map<string, Update[]>();

/** Reading-pane scroll position per email, and the list's, so re-renders (selection, state pushes) don't jump. */
const paneScroll = new Map<string, number>();
let listScroll = 0;

/** Called while the old DOM is still on screen: remember where both panes are scrolled. */
function saveScroll(): void {
  const pl = document.querySelector<HTMLElement>('.g-split .pl');
  const pr = document.querySelector<HTMLElement>('.g-split .pr');
  if (pl) listScroll = pl.scrollTop;
  const shown = pr?.querySelector<HTMLElement>('.g-pane[data-key]')?.dataset.key;
  if (pr && shown) paneScroll.set(shown, pr.scrollTop);
}

/** After the new DOM is attached: put both panes back (an email never seen opens at the top). */
function restoreScroll(): void {
  const pl = document.querySelector<HTMLElement>('.g-split .pl');
  const pr = document.querySelector<HTMLElement>('.g-split .pr');
  if (pl) pl.scrollTop = listScroll;
  if (pr) pr.scrollTop = (ui.selectedKey && paneScroll.get(ui.selectedKey)) || 0;
}

export function renderUpdates(): HTMLElement {
  const s = ui.state;
  saveScroll();
  // render() attaches the returned tree synchronously; restore once it is in the document.
  queueMicrotask(restoreScroll);
  const wrap = h('div', {});
  const watching = s.accounts.filter((a) => a.watching);
  if (!s.accounts.length) {
    wrap.append(banner('info', [h('strong', {}, 'Add a mailbox to get started. '), 'Type your email address and Pilot sets up the rest.'],
      [button('Add mailbox', { kind: 'primary', onClick: () => { ui.addFlow = { email: '', busy: '', password: '' }; go('mailboxes'); } })]));
  } else if (!watching.length) {
    wrap.append(banner('info', [h('strong', {}, "Pilot isn't watching any mailbox yet. "), 'Open Mailboxes, check the permissions, and press Start watching.'],
      [button('Go to Mailboxes', { kind: 'primary', onClick: () => go('mailboxes') })]));
  }
  if (watching.length) wrap.append(renderBriefing());

  const open = s.updates.filter((u) => u.status !== 'done');
  const done = s.updates.filter((u) => u.status === 'done');
  const list = ui.tab === 'done' ? done : open;
  if (!list.some((u) => u.key === ui.selectedKey)) ui.selectedKey = list[0]?.key ?? null;
  const groups: [string, Update[]][] = ui.tab === 'done' ? [['Done', done]] : [
    ['Needs you', open.filter((u) => u.status === 'new' && u.triage?.priority === 1)],
    ['Worth a look', open.filter((u) => u.status === 'new' && u.triage?.priority === 2)],
    ['Not read yet', open.filter((u) => u.status === 'new' && !u.triage)],
    ['Snoozed', open.filter((u) => u.status === 'snoozed')],
    ['Low priority', open.filter((u) => u.status === 'new' && u.triage?.priority === 3)],
  ];
  clusterOf.clear();
  const shortcuts = h('button', { class: 'g-btn ghost tiny keys-hint', type: 'button', title: 'Keyboard shortcuts', onclick: () => { ui.showKeys = true; document.body.append(keysOverlay()); } }, 'Shortcuts: ?');
  const drafts = open.filter((u) => u.reply?.state === 'drafted').length;
  const left = h('div', { class: 'pl' },
    tabs([{ id: 'open', label: 'Open', count: open.length }, { id: 'done', label: 'Done', count: done.length }], ui.tab, (t) => { ui.tab = t; render(); }, shortcuts),
    ui.tab === 'open' && drafts ? h('div', { class: 'g-hint g-drafts' }, `${drafts} reply draft${drafts === 1 ? '' : 's'} waiting in your mailbox`) : null,
    ...groups.filter(([, xs]) => xs.length).flatMap(([title, xs]) => [sectionTitle(title, xs.length), ...paneRows(xs)]));
  const sel = list.find((u) => u.key === ui.selectedKey);
  const right = h('div', { class: 'pr' }, sel
    ? emailPane(sel)
    : emptyState(ui.tab === 'done' ? 'Nothing marked done yet.' : watching.length ? "You're all caught up." : 'Nothing here yet.'));
  if (s.activity.some((a) => a.status === 'proposed')) {
    const n = s.activity.filter((a) => a.status === 'proposed').length;
    wrap.append(banner('warn', [h('strong', {}, `${n} action${n === 1 ? '' : 's'} waiting for your approval. `), 'Preview mode is on, so Pilot proposes automatic actions instead of doing them.'], [button('Review in Activity', { onClick: () => go('activity') })]));
  }
  wrap.append(h('div', { class: 'g-split' }, left, right));
  return wrap;
}

/** Similar emails collapse into one row with a count; clicking selects the newest. */
function paneRows(xs: Update[]): HTMLElement[] {
  const byKey = new Map(xs.map((u) => [u.key, u]));
  const clusters = cluster(xs.map((u) => ({ key: u.key, from: u.message.from.email, subject: u.message.subject, at: u.message.receivedAt })));
  // Keep the section's own order (by importance), placing each cluster where its newest email was.
  const order = new Map(xs.map((u, i) => [u.key, i]));
  clusters.sort((a, b) => Math.min(...a.map((x) => order.get(x.key)!)) - Math.min(...b.map((x) => order.get(x.key)!)));
  return clusters.map((c) => {
    const u = byKey.get(c[0].key)!;
    const members = c.map((x) => byKey.get(x.key)!);
    clusterOf.set(u.key, members);
    const t = u.triage;
    return listRow({
      key: u.key,
      dot: t?.priority === 1 ? 'p1' : t?.priority === 2 ? 'p2' : 'low',
      title: [h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, u.message.from.name || u.message.from.email), c.length > 1 ? chip(String(c.length)) : null, u.reply?.state === 'drafted' ? chip('Draft saved', 'accent') : null],
      sub: u.message.subject || '(no subject)',
      right: relTime(u.message.receivedAt),
      selected: members.some((m) => m.key === ui.selectedKey),
      onClick: () => { ui.selectedKey = u.key; render(); },
    });
  });
}

/** The row to select after the selected email leaves the list (Done, Archive, Snooze). */
export function nextKeyAfter(key: string): string | null {
  const rows = [...document.querySelectorAll<HTMLElement>('.g-split .pl .g-row[data-key]')];
  const at = rows.findIndex((r) => r.dataset.key === key);
  if (at < 0) return ui.selectedKey;
  return rows[at + 1]?.dataset.key ?? rows[at - 1]?.dataset.key ?? null;
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

/** The selected email in full: what it says, what it asks of you, and every action on it. */
export function emailPane(u: Update): HTMLElement {
  const m = u.message;
  const t = u.triage;
  const account = accountOf(u);
  const isOpen = u.status !== 'done';
  const canOpen = !!(m.webLink || account?.webmailUrl);
  // Done/Archive take the email out of the list; select the next row so the pane follows.
  const leave = (action: 'done' | 'archive') => { ui.selectedKey = nextKeyAfter(u.key); quickAct(u, action); };
  const toggleOriginal = () => {
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
  };
  const original = button(showOriginal.has(u.key) ? 'Hide original' : 'Show original', { kind: 'ghost', icon: 'eye', onClick: toggleOriginal });
  const openInMail = canOpen ? button('Open in mail', { kind: 'ghost', icon: 'link', onClick: () => void run(() => api.open(u.key)) }) : null;

  const acts: (HTMLElement | null)[] = isOpen
    ? [
        editors.has(u.key) ? null : button(t?.draftReply ? 'Review reply' : 'Reply', { kind: 'primary', icon: 'reply', onClick: () => openReply(u) }),
        button('Done', { icon: 'check', onClick: () => leave('done') }),
        account?.permissions.manage ? button('Archive', { icon: 'archive', onClick: () => leave('archive') }) : null,
        u.status === 'new'
          ? button('Snooze', { icon: 'snooze', onClick: () => { ui.snoozeFor = ui.snoozeFor === u.key ? null : u.key; snoozeText = ''; render(); } })
          : button('Unsnooze', { icon: 'snooze', onClick: () => void run(() => api.act(u.key, 'reopen')) }),
        t?.needsReply && !t.repliedAlready ? button('Remind me', { icon: 'clock', onClick: () => openRemind(`u:${u.key}`) }) : null,
        h('span', { class: 'g-spacer' }),
        openInMail,
        u.thread?.length
          ? button(showThread.has(u.key) ? 'Hide conversation' : `Conversation (${u.thread.length})`, {
              kind: 'ghost',
              onClick: () => {
                if (!showThread.delete(u.key)) showThread.add(u.key);
                render();
              },
            })
          : null,
        original,
        button('Re-read', { kind: 'ghost', icon: 'refresh', title: 'Read this email again and refresh the summary', onClick: () => void run(() => api.redraft(u.key), 'Summary refreshed') }),
      ]
    : [
        button('Move back to open', { icon: 'undo', onClick: () => void run(() => api.act(u.key, 'reopen')) }),
        h('span', { class: 'g-spacer' }),
        openInMail,
        original,
      ];

  const dates = ui.state.items.filter((i) => i.status === 'open' && i.sourceKeys.includes(u.key));
  const kv: [string, string][] = [];
  if (t?.openQuestions?.length && !t.repliedAlready) kv.push(['Still waiting on you', t.openQuestions.join(' · ')]);
  if (t?.userPromises?.length) kv.push(['You promised', t.userPromises.join(' · ')]);
  if (dates.length) kv.push(['Deadline', dateText(dates[0])]);
  if (m.attachmentNames?.length) kv.push([m.attachmentNames.length === 1 ? 'Attachment' : 'Attachments', `${m.attachmentNames.join(', ')} (read)`]);
  if (t?.actionItems.length) kv.push(['To do', t.actionItems.join(' · ')]);

  const members = [...clusterOf.values()].find((c) => c.some((x) => x.key === u.key)) ?? [];

  return h('article', { class: `g-pane p${t?.priority ?? 0}${isOpen ? '' : ' done'}`, 'data-key': u.key },
    h('div', { class: 'g-pane-head' },
      h('strong', { title: m.from.email }, m.from.name || m.from.email || 'Unknown sender'),
      t ? chip(CAT_LABEL[t.category], t.priority === 1 ? 'accent' : 'neutral') : null,
      m.from.name ? h('span', { class: 'g-hint', style: 'margin:0' }, m.from.email) : null,
      h('span', { class: 'r' }, `${relTime(m.receivedAt)}${ui.state.accounts.length > 1 && account ? ` · ${account.email}` : ''}`)),
    h('div', { class: 'g-pane-subj' }, m.subject || '(no subject)'),
    h('p', { class: 'g-pane-sum' }, t ? t.summary : u.triageError ? `Couldn't summarize this one: ${u.triageError}` : m.snippet),
    u.status === 'snoozed' && u.snoozeUntil
      ? h('div', { class: 'g-hint' }, u.snoozeUntilReply ? `Snoozed until they reply (at the latest ${new Date(u.snoozeUntil).toLocaleDateString()})` : `Snoozed until ${new Date(u.snoozeUntil).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      : null,
    kv.length ? h('div', { class: 'g-kv' }, kv.map(([k, v]) => h('div', {}, h('span', {}, k), v))) : null,
    dates.length > 1 ? keyDates(u) : null,
    t ? whyLine(u) : null,
    u.reply ? replyLine(u.reply) : null,
    autoLine(u),
    proposalsFor(u),
    showThread.has(u.key) && u.thread ? conversation(u) : null,
    showOriginal.has(u.key) ? h('pre', { class: 'original' }, bodies.get(u.key) ?? 'Loading…') : null,
    h('div', { class: 'g-acts' }, acts),
    editors.has(u.key) ? replyEditor(u) : null,
    ui.remindFor === `u:${u.key}` ? remindBox({ kind: 'update', key: u.key }) : null,
    ui.snoozeFor === u.key ? snoozeBox(u) : null,
    t && isOpen ? correctionBar(u) : null,
    members.length > 1 ? similarBox(members) : null);
}

/** Kept for older callers: the email card is now the reading pane. */
export const card = emailPane;

/** One key date as plain text, for the pane's Deadline field. */
function dateText(i: AppState['items'][number]): string {
  return `${i.title} · ${fmtWhen(i)}${i.amount !== undefined ? ` · ${fmtMoney(i)}` : ''}`;
}

/** The emails collapsed into one list row, each selectable, with "Mark all done". */
function similarBox(members: Update[]): HTMLElement {
  const first = members[0];
  const open = members.filter((x) => x.status !== 'done');
  return h('div', { class: 'g-similar' },
    sectionTitle(`Similar from ${first.message.from.name || first.message.from.email}`, members.length),
    members.map((x) => listRow({
      dot: null,
      title: x.message.subject || '(no subject)',
      right: relTime(x.message.receivedAt),
      selected: x.key === ui.selectedKey,
      onClick: () => { ui.selectedKey = x.key; render(); },
    })),
    open.length > 1
      ? h('div', { class: 'g-acts' }, button(`Mark all ${open.length} done`, { icon: 'check', onClick: () => void run(() => api.doneMany(open.map((x) => x.key)), `Marked ${open.length} done`) }))
      : null);
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
    h('span', { class: 'g-hint', style: 'margin:0' }, 'Teach Pilot:'),
    button('More important', { kind: 'ghost', tiny: true, icon: 'thumbUp', onClick: () => fix('more', 'once', 'Got it. Only this email changes.') }),
    button('Less important', { kind: 'ghost', tiny: true, icon: 'thumbDown', onClick: () => fix('less', 'once', 'Got it. Only this email changes.') }),
    button('Junk', { kind: 'ghost', tiny: true, icon: 'trash', onClick: () => fix('junk', 'once', 'Moved to Done. Only this email changes.') }),
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
