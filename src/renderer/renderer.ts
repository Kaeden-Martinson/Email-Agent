import type {
  Account,
  AccountPatch,
  ActivityEntry,
  Commitment,
  CorrectionKind,
  FollowUp,
  KeyItem,
  KeyItemKind,
  NotificationSettings,
  NotifyChannel,
  NotifyEvent,
  PrivacyLevel,
  OwedReply,
  Reminder,
  ReminderTarget,
  Priority,
  Rule,
  RulePreview,
  SuggestedRule,
  TriageSource,
  AccountPermissions,
  Api,
  AppState,
  AskResult,
  SearchHit,
  Category,
  Discovery,
  ReplyMode,
  ReplyRecord,
  ServerConfig,
  Settings,
  Subscription,
  Update,
} from '../shared/types.js';
import { cluster } from '../shared/group.js';

declare global {
  interface Window {
    api: Api;
  }
}

type View = 'today' | 'ask' | 'updates' | 'deadlines' | 'followups' | 'mailboxes' | 'subscriptions' | 'activity' | 'sorting' | 'rules' | 'notifications' | 'settings';

const api = window.api;
const root = document.getElementById('app')!;
let state: AppState;
let view: View = 'today';
let tab: 'open' | 'done' = 'open';
let onboardStep: 'name' | 'mail' = 'name';
/** Reply text being edited, by update key. Survives re-renders. */
const editors = new Map<string, string>();
const showOriginal = new Set<string>();
/** Email bodies fetched on demand (state carries no bodies). */
const bodies = new Map<string, string>();
/** Cards with the conversation panel open. */
const showThread = new Set<string>();
/** Mailboxes whose permissions panel is expanded. */
const openPerms = new Set<string>();
/** The add-mailbox flow in progress, if any. */
let addFlow: { email: string; busy: string; discovery?: Discovery; password: string; access?: 'full' | 'readonly' } | null = null;
let deferredRender = false;

const CAT_LABEL: Record<Category, string> = {
  action: 'Action',
  reply: 'Reply',
  fyi: 'FYI',
  newsletter: 'Newsletter',
  promo: 'Promo',
  notification: 'Notification',
  spam: 'Spam',
};

// ---- helpers ----

type Child = Node | string | null | undefined | false;

/** Builds DOM with text nodes only, so nothing from an email is ever parsed as HTML. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

let toastTimer: number | undefined;

/** A short message at the bottom; with `action`, a button (like Undo) that stays for 8 seconds. */
function toast(text: string, action?: { label: string; fn: () => void }): void {
  const t = document.getElementById('toast')!;
  t.replaceChildren(text);
  if (action) {
    t.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { t.classList.remove('show'); action.fn(); } }, action.label));
  }
  t.classList.toggle('actionable', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), action ? 8000 : 4500);
}

/** Done, Snooze and Archive on one email, each with Undo in the toast. */
function quickAct(u: Update, action: 'done' | 'snooze' | 'archive'): void {
  void run(async () => {
    const id = await api.act(u.key, action);
    const what = action === 'archive' ? 'Archived' : action === 'done' ? 'Marked done' : 'Snoozed till tomorrow';
    toast(what, {
      label: 'Undo',
      fn: () => void run(() => (action === 'archive' && id ? api.undo(id) : api.act(u.key, 'reopen')), 'Undone'),
    });
  });
}

async function run(fn: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await fn();
    if (done) toast(done);
    return true;
  } catch (e) {
    toast(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return false;
  }
}

function relTime(ms: number): string {
  const mins = (Date.now() - ms) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const btn = (label: string, onclick: () => void, cls = '', disabled = false) =>
  h('button', { class: `btn ${cls}`, type: 'button', onclick, disabled }, label);

const valueOf = (e: Event) => (e.target as HTMLInputElement).value;

const accountOf = (u: Update) => state.accounts.find((a) => a.id === u.message.accountId);

const go = (v: View) => {
  view = v;
  render();
};

// ---- rendering ----

/** One-time notices from the app, e.g. data restored from a backup. */
function renderNotice(): HTMLElement | null {
  const n = state.app.notice;
  if (!n) return null;
  return h('div', { class: 'banner approve-banner' }, h('strong', {}, 'Heads up: '), n,
    h('div', { class: 'actions' }, btn('Dismiss', () => void run(() => api.dismissNotice()))));
}

function render(): void {
  if (!state.settings.onboarded) {
    root.replaceChildren(renderOnboarding());
    return;
  }
  root.replaceChildren(h('div', { class: 'layout' }, renderNav(), h('main', {}, renderHeader(), renderNotice(), renderView())));
}

/** On a state push, re-render unless the user is typing; the form views keep their own values. */
function onState(next: AppState): void {
  state = next;
  const active = document.activeElement;
  const typing =
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type !== 'checkbox' && active.type !== 'radio') ||
    active instanceof HTMLSelectElement;
  if (state.settings.onboarded && (view === 'rules' || view === 'settings')) {
    document.querySelector('nav')?.replaceWith(renderNav());
    document.querySelector('header.top')?.replaceWith(renderHeader());
  } else if (typing) {
    deferredRender = true;
  } else {
    render();
  }
}

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (deferredRender && !(active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement)) {
      deferredRender = false;
      render();
    }
  });
});

function renderNav(): HTMLElement {
  const open = state.updates.filter((u) => u.status === 'new').length;
  const watching = state.accounts.filter((a) => a.watching).length;
  const suggestions = state.subscriptions.filter((s) => !s.unsubscribedAt && s.count >= 2).length;
  const proposed = state.activity.filter((a) => a.status === 'proposed').length;
  const item = (v: View, label: string, count?: string) =>
    h(
      'button',
      { class: view === v ? 'active' : '', onclick: () => go(v) },
      h('span', {}, label),
      count ? h('span', { class: 'count' }, count) : null,
    );
  return h(
    'nav',
    {},
    h('div', { class: 'brand' }, 'Inbox Pilot',
      h('small', {}, state.status.demo ? 'Demo mode' : state.settings.userName ? `${state.settings.userName}'s Pilot` : 'Your email Pilot')),
    item('today', 'Today'),
    item('ask', 'Ask', 'Ctrl+K'),
    item('updates', 'Updates', open ? String(open) : undefined),
    item('deadlines', 'Deadlines', itemsDueSoon() ? `${itemsDueSoon()} soon` : undefined),
    item('followups', 'Follow-ups', dueCount() ? `${dueCount()} due` : undefined),
    item('mailboxes', 'Mailboxes', state.accounts.length ? `${watching}/${state.accounts.length}` : undefined),
    item('subscriptions', 'Subscriptions', suggestions ? String(suggestions) : undefined),
    item('activity', 'Activity', proposed ? String(proposed) : undefined),
    item('sorting', 'Rules', state.suggestedRules.length ? `${state.suggestedRules.length} new` : undefined),
    item('rules', 'Replies'),
    item('notifications', 'Notifications', state.notifier.held ? `${state.notifier.held} held` : undefined),
    item('settings', 'Settings'),
  );
}

function renderHeader(): HTMLElement {
  const titles: Record<View, string> = {
    today: 'Today',
    ask: 'Ask my inbox',
    updates: 'Updates',
    deadlines: 'Deadlines & bills',
    followups: 'Follow-ups',
    mailboxes: 'Mailboxes',
    subscriptions: 'Subscriptions',
    activity: 'Activity',
    sorting: 'Rules',
    rules: 'Replies',
    notifications: 'Notifications',
    settings: 'Settings',
  };
  const s = state.status;
  const msg = s.message ?? (s.lastRunAt ? `Checked ${relTime(s.lastRunAt)}` : '');
  return h(
    'header',
    { class: 'top' },
    h('h1', {}, titles[view]),
    h('span', { class: `status ${s.ollamaOk === false ? 'warn' : ''}` }, msg),
    btn(s.syncing ? 'Checking…' : 'Check now', () => void run(() => api.syncNow()), '', s.syncing),
  );
}

function renderView(): HTMLElement {
  switch (view) {
    case 'today': return renderToday();
    case 'ask': return renderAsk();
    case 'updates': return renderUpdates();
    case 'deadlines': return renderDeadlines();
    case 'followups': return renderFollowUps();
    case 'mailboxes': return renderMailboxes();
    case 'subscriptions': return renderSubscriptions();
    case 'activity': return renderActivity();
    case 'sorting': return renderSorting();
    case 'rules': return renderRules();
    case 'notifications': return renderNotifications();
    case 'settings': return renderSettings();
  }
}

// ---- onboarding ----

function renderOnboarding(): HTMLElement {
  if (onboardStep === 'name') {
    const name = h('input', { type: 'text', value: state.settings.userName, placeholder: 'Your name', autofocus: true });
    return h('div', { class: 'onboard' },
      h('h1', {}, 'Welcome to Inbox Pilot'),
      h('p', { class: 'lede' },
        'Your Pilot lives on this PC and works for one person: you. It watches the mailboxes you connect, tells you what matters, and only replies the way you allow.'),
      h('form', { class: 'settings', onsubmit: (e: Event) => {
        e.preventDefault();
        const userName = name.value.trim();
        if (!userName) return toast('Enter your name to continue.');
        void run(async () => {
          onboardStep = 'mail';
          await api.saveSettings({ userName });
        });
      } },
        field('What should your Pilot call you?', name, 'It uses this when it writes replies for you.'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Continue')));
  }

  const finish = async (accountId?: string) => {
    view = 'mailboxes';
    if (accountId) openPerms.add(accountId);
    await run(() => api.saveSettings({ onboarded: true }));
  };
  return h('div', { class: 'onboard' },
    h('h1', {}, `Hi ${state.settings.userName}, let's add your first mailbox`),
    h('p', { class: 'lede' },
      "Type an email address. Pilot works out whether it's Gmail, Outlook or another provider and sets it up for you. You can add more mailboxes later."),
    renderAddMailbox((id) => {
      void finish(id);
      toast('Mailbox added. Choose what Pilot may do there, then press Start watching.');
    }),
    h('div', { class: 'actions' },
      btn('Back', () => { onboardStep = 'name'; render(); }, 'ghost'),
      btn('Skip for now', () => void finish(), 'ghost')));
}

// ---- add mailbox ----

function serverFields(label: string, server: ServerConfig): HTMLElement {
  return h('div', { class: 'field' },
    h('label', {}, label),
    h('div', { class: 'row' },
      h('input', { type: 'text', value: server.host, oninput: (e: Event) => { server.host = valueOf(e).trim(); } }),
      h('input', { type: 'number', class: 'port', value: String(server.port), oninput: (e: Event) => { server.port = Number(valueOf(e)); } }),
      h('label', { class: 'check inline' },
        h('input', { type: 'checkbox', checked: server.secure, onchange: (e: Event) => { server.secure = (e.target as HTMLInputElement).checked; } }),
        'SSL/TLS')),
    h('div', { class: 'hint' }, 'Unticked means STARTTLS.'));
}

function renderAddMailbox(onAdded: (id: string) => void, onCancel?: () => void): HTMLElement {
  const f = (addFlow ??= { email: '', busy: '', password: '' });
  const d = f.discovery;

  const connect = () => {
    if (!d) return;
    f.busy = d.kind === 'imap' ? 'Checking the password with the server…' : 'Waiting for you to sign in in your browser…';
    render();
    void run(async () => {
      try {
        const id = await api.connect({ ...d, password: f.password, access: f.access ?? 'full' });
        addFlow = null;
        onAdded(id);
      } finally {
        if (addFlow) {
          addFlow.busy = '';
          render();
        }
      }
    });
  };

  if (!d) {
    const email = h('input', {
      type: 'email',
      value: f.email,
      placeholder: 'you@example.com',
      autofocus: true,
      oninput: (e: Event) => { f.email = valueOf(e); },
    });
    return h('form', { class: 'add-mailbox', onsubmit: (e: Event) => {
      e.preventDefault();
      f.busy = 'Looking up your provider…';
      render();
      void run(async () => {
        try {
          f.discovery = await api.discover(f.email);
        } finally {
          f.busy = '';
          render();
        }
      });
    } },
      field('Email address', h('div', { class: 'row' }, email,
        h('button', { class: 'btn primary', type: 'submit', disabled: !!f.busy }, f.busy ? 'Looking…' : 'Continue'))),
      f.busy ? h('div', { class: 'hint' }, f.busy) : null,
      onCancel ? btn('Cancel', onCancel, 'ghost') : null);
  }

  const reset = () => {
    f.discovery = undefined;
    f.password = '';
    render();
  };
  const head = h('div', { class: 'found' },
    h('div', {}, h('strong', {}, d.email), ` · ${d.providerName}`),
    btn('Use a different address', reset, 'ghost', !!f.busy));

  const footer = [
    f.busy ? h('div', { class: 'hint busy' }, f.busy) : null,
    f.busy && d.kind !== 'imap'
      ? h('div', { class: 'hint' }, "Blocked, or closed the browser tab? Cancel and sign in again.",
          btn('Cancel sign-in', () => void run(() => api.cancelSignIn())))
      : null,
    onCancel ? btn('Cancel', () => { addFlow = null; onCancel(); }, 'ghost', !!f.busy) : null,
  ];

  if (d.kind !== 'imap') {
    const brand = d.kind === 'gmail' ? 'Google' : 'Microsoft';
    const available = state.signIn[d.kind];
    return h('div', { class: 'add-mailbox' }, head,
      available
        ? h('p', { class: 'hint' }, `Your browser opens a ${brand} sign-in page. Inbox Pilot never sees your password.`)
        : h('p', { class: 'err' },
            `${brand} sign-in isn't set up in this copy of Inbox Pilot yet. The developer needs to add a ${brand} client to oauth-clients.json (see the README).`),
      h('div', { class: 'field' }, h('label', {}, 'What Pilot may do'),
        ([
          ['full', 'Full access (recommended)', 'Read mail, and, only when you allow it per mailbox, archive, label, save drafts or send.'],
          ['readonly', 'Read-only', 'Summaries, search, deadlines and reminders only. Pilot can never change this mailbox or send from it.'],
        ] as ['full' | 'readonly', string, string][]).map(([value, label, hint]) =>
          h('label', { class: 'check' },
            h('input', { type: 'radio', name: 'access', checked: (f.access ?? 'full') === value, onchange: () => { f.access = value; } }),
            h('span', {}, h('strong', {}, label), h('div', { class: 'hint' }, hint))))),
      h('div', { class: 'actions' }, btn(`Sign in with ${brand}`, connect, 'primary', !available || !!f.busy)),
      footer);
  }

  const password = h('input', {
    type: 'password',
    value: f.password,
    autofocus: true,
    oninput: (e: Event) => { f.password = valueOf(e); },
  });
  return h('form', { class: 'add-mailbox', onsubmit: (e: Event) => { e.preventDefault(); connect(); } }, head,
    d.note ? h('p', { class: 'hint' }, d.note) : null,
    field(d.appPasswordUrl ? 'App password' : 'Password', password,
      d.appPasswordUrl
        ? `${d.providerName} needs an app password for apps like this one, not your normal password.`
        : 'Some providers need an app password here instead of your normal password.'),
    d.appPasswordUrl ? btn(`Create an app password at ${d.providerName}`, () => void run(() => api.openUrl(d.appPasswordUrl!)), 'ghost') : null,
    d.imap && d.smtp
      ? h('details', { class: 'servers' }, h('summary', {}, 'Server settings'), serverFields('Incoming (IMAP)', d.imap), serverFields('Outgoing (SMTP)', d.smtp))
      : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: !!f.busy }, 'Connect')),
    footer);
}

// ---- mailboxes ----

function renderMailboxes(): HTMLElement {
  const wrap = h('div');
  if (addFlow) {
    wrap.append(h('div', { class: 'banner' }, h('h3', {}, 'Add a mailbox'),
      renderAddMailbox((id) => {
        openPerms.add(id);
        render();
        toast('Mailbox added. Choose what Pilot may do there, then press Start watching.');
      }, () => render())));
  } else {
    wrap.append(h('div', { class: 'actions top-actions' },
      btn('Add mailbox', () => { addFlow = { email: '', busy: '', password: '' }; render(); }, 'primary')));
  }
  if (!state.accounts.length && !addFlow) {
    wrap.append(h('div', { class: 'empty' }, 'No mailboxes yet. Add Gmail, Outlook, Yahoo, iCloud or any other address.'));
  }
  for (const a of state.accounts) wrap.append(mailboxCard(a));
  return wrap;
}

function mailboxCard(a: Account): HTMLElement {
  const open = openPerms.has(a.id);
  const update = (patch: AccountPatch, done?: string) => void run(() => api.updateAccount(a.id, patch), done);
  const status = a.lastError
    ? h('div', { class: 'err' }, a.lastError)
    : h('div', { class: 'hint' },
        a.watching ? (a.lastSyncAt ? `Last checked ${relTime(a.lastSyncAt)}` : 'Starting…') : "Paused. Pilot isn't reading this mailbox.");
  return h('div', { class: 'banner mailbox' },
    h('div', { class: 'mailbox-head' },
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, a.email), ` · ${a.providerName}`,
          h('span', { class: `pill ${a.watching ? 'on' : 'off'}` }, a.watching ? 'Watching' : 'Paused')),
        status),
      a.needsReconnect && a.kind !== 'imap'
        ? btn('Reconnect', () =>
            void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: a.calendar }), 'Reconnected. Checking mail…'), 'primary')
        : null,
      a.watching
        ? btn('Pause', () => update({ watching: false }, `Paused ${a.email}`))
        : btn('Start watching', () => update({ watching: true }, `Pilot is now watching ${a.email}`), 'primary'),
      btn(open ? 'Hide permissions' : 'Permissions', () => {
        if (!openPerms.delete(a.id)) openPerms.add(a.id);
        render();
      }),
      btn('Remove', () => {
        if (confirm(`Disconnect ${a.email}? Its updates are removed from Inbox Pilot. Nothing is deleted from the mailbox.`)) {
          void run(() => api.removeAccount(a.id));
        }
      }, 'ghost danger')),
    open ? permissionsPanel(a) : null);
}

function permissionsPanel(a: Account): HTMLElement {
  const p = a.permissions;
  const set = (perm: Partial<AccountPermissions>) => void run(() => api.updateAccount(a.id, { permissions: perm }));
  const ro = a.access === 'readonly';
  const toggle = (label: string, hint: string, checked: boolean, onchange: (v: boolean) => void, writes = false) =>
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked, disabled: writes && ro, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }),
      h('span', {}, label, h('div', { class: 'hint' }, hint)));

  const modes: [ReplyMode, string, string][] = [
    ['off', 'Suggest only', 'Draft replies show up in Inbox Pilot. Nothing goes to the mailbox until you press Send.'],
    ['draft', 'Save drafts', 'Put a reply draft in this mailbox for each email that needs one. Nothing is sent.'],
    ['send', 'Auto-send to trusted senders', 'Send replies on its own, but only to the senders below. Everyone else gets a draft.'],
  ];

  return h('div', { class: 'perms' },
    ro
      ? h('div', { class: 'banner approve-banner' },
          h('strong', {}, 'Connected read-only. '),
          "Pilot can read and summarize this mailbox but can't change it or send from it, so archiving, labels, drafts and replies are off.",
          a.kind !== 'imap'
            ? h('div', { class: 'actions' }, btn('Reconnect with full access', () =>
                void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: 'full', calendar: a.calendar }), 'Reconnected with full access')))
            : null)
      : null,
    a.kind !== 'imap'
      ? h('div', { class: 'banner' },
          h('strong', {}, a.calendar ? 'Calendar connected. ' : 'Calendar: not connected. '),
          a.calendar
            ? 'When an email asks to find a time, reply suggestions offer your free times. Pilot sees only when you are busy, never event details, and never books anything.'
            : 'Let reply suggestions offer your free times. Pilot asks only for free/busy access: when you are busy, never event titles or details.',
          h('div', { class: 'actions' }, a.calendar
            ? btn('Disconnect calendar', () => void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: false }), 'Calendar disconnected'), 'ghost')
            : btn('Connect calendar', () => void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: true }), 'Calendar connected'))))
      : null,
    h('h4', {}, 'What Pilot may do here'),
    toggle('Read new mail and add it to my updates', 'This is the Start watching / Pause switch.', a.watching,
      (v) => void run(() => api.updateAccount(a.id, { watching: v }))),
    toggle('Alert me about important mail', 'A Windows notification for anything marked "needs you today".', p.notify, (v) => set({ notify: v })),
    toggle('Archive emails when I ask', 'Lets the Archive button move mail out of the inbox in this mailbox.', p.manage, (v) => set({ manage: v }), true),
    h('h4', {}, 'Replies'),
    modes.map(([value, label, hint]) =>
      h('label', { class: 'check' },
        h('input', { type: 'radio', name: `replies-${a.id}`, value, checked: p.replies === value, disabled: ro && value !== 'off', onchange: () => set({ replies: value }) }),
        h('span', {}, h('strong', {}, label), h('div', { class: 'hint' }, hint)))),
    field('Trusted senders',
      h('textarea', {
        rows: 3,
        value: p.trustedSenders.join('\n'),
        placeholder: 'boss@company.com\n@company.com',
        onchange: (e: Event) => set({ trustedSenders: valueOf(e).split(/[\n,]/).map((s) => s.trim()).filter(Boolean) }),
      }),
      'One per line: a full address, or @domain for everyone at that company. Only used for auto-send.'),
    field('Signature for this mailbox',
      h('textarea', { rows: 2, value: p.signature, onchange: (e: Event) => set({ signature: valueOf(e) }) })),
    h('h4', {}, 'Autopilot'),
    toggle('Sort mail with Pilot labels', labelHint(a), p.labels, (v) => set({ labels: v }), true),
    h('div', { class: 'field' },
      h('label', {}, 'Archive automatically once summarized'),
      ([['newsletter', 'Newsletters'], ['promo', 'Promotions'], ['notification', 'Notifications, receipts and alerts']] as [Category, string][]).map(([c, label]) =>
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: p.autoClean.includes(c),
            disabled: !p.manage || ro,
            onchange: (e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              set({ autoClean: on ? [...p.autoClean, c] : p.autoClean.filter((x) => x !== c) });
            },
          }),
          h('span', {}, label))),
      h('div', { class: 'hint' },
        p.manage
          ? "They stay in your mailbox's archive and on the Done tab here. Anything urgent or waiting on a reply is never archived."
          : 'Turn on "Archive emails when I ask" above to use this.')),
    h('div', { class: 'field' },
      h('label', {}, 'Unsubscribing'),
      ([
        ['off', 'Off', ''],
        ['suggest', 'Suggest senders to unsubscribe from', 'They appear under Subscriptions with an Unsubscribe button.'],
        ['auto', 'Unsubscribe automatically', `After ${3} newsletters or promotions from the same sender in 30 days, using the sender's one-click unsubscribe. Pilot never visits unsubscribe web pages on its own.`],
      ] as ['off' | 'suggest' | 'auto', string, string][]).map(([value, label, hint]) =>
        h('label', { class: 'check' },
          h('input', { type: 'radio', name: `unsub-${a.id}`, checked: p.unsubscribe === value, onchange: () => set({ unsubscribe: value }) }),
          h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null)))),
    h('div', { class: 'hint' }, 'Changes save as you make them. Which kinds of email get replies, the tone and the daily send limit are under Reply rules.'));
}

function labelHint(a: Account): string {
  if (a.kind === 'gmail') return 'Adds labels such as Pilot/Action and Pilot/Newsletters in Gmail.';
  if (a.kind === 'outlook') return 'Adds Outlook categories such as "Pilot: Action".';
  return 'Adds keywords such as Pilot_Action. Thunderbird and Apple Mail show them; some servers ignore them.';
}

// ---- subscriptions ----

function renderSubscriptions(): HTMLElement {
  const wrap = h('div');
  const subs = state.subscriptions;
  wrap.append(h('p', { class: 'hint' },
    'Newsletters and promotions your Pilot has seen in the last 30 days, busiest first. Turn automatic unsubscribing on per mailbox under Mailboxes → Permissions.'));
  if (!subs.length) {
    wrap.append(h('div', { class: 'empty' }, 'No newsletters or promotions yet.'));
    return wrap;
  }
  for (const s of subs) wrap.append(subscriptionRow(s));
  return wrap;
}

function subscriptionRow(s: Subscription): HTMLElement {
  const account = state.accounts.find((a) => a.id === s.accountId);
  const how = s.unsubscribe
    ? s.unsubscribe.oneClick ? 'One-click unsubscribe' : s.unsubscribe.mailto ? 'Unsubscribes by email' : 'Unsubscribes on their website'
    : 'No unsubscribe link';
  const action = s.unsubscribedAt
    ? h('span', { class: 'pill off' }, `Unsubscribed ${relTime(s.unsubscribedAt)}`)
    : s.unsubscribe
      ? btn('Unsubscribe', () => void run(async () => {
          const r = await api.unsubscribe(s.accountId, s.sender);
          toast(r.message);
          if (r.openUrl) await api.openUrl(r.openUrl);
        }), 'primary')
      : null;
  return h('div', { class: 'banner sub-row' },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, s.name || s.sender), s.name ? ` · ${s.sender}` : ''),
      h('div', { class: 'hint' },
        `${s.count} email${s.count === 1 ? '' : 's'} in 30 days · last ${relTime(s.lastAt)} · ${how}` +
          (state.accounts.length > 1 && account ? ` · ${account.email}` : '') +
          (s.method ? ` · via ${s.method}` : ''))),
    action);
}

// ---- updates ----

function renderUpdates(): HTMLElement {
  const wrap = h('div');
  const watching = state.accounts.filter((a) => a.watching);
  if (!state.accounts.length) {
    wrap.append(h('div', { class: 'banner' },
      h('strong', {}, 'Add a mailbox to get started. '),
      'Type your email address and Pilot sets up the rest.',
      h('div', { class: 'actions' }, btn('Add mailbox', () => { addFlow = { email: '', busy: '', password: '' }; go('mailboxes'); }, 'primary'))));
  } else if (!watching.length) {
    wrap.append(h('div', { class: 'banner' },
      h('strong', {}, "Pilot isn't watching any mailbox yet. "),
      'Open Mailboxes, check the permissions, and press Start watching.',
      h('div', { class: 'actions' }, btn('Go to Mailboxes', () => go('mailboxes'), 'primary'))));
  }

  if (watching.length) wrap.append(renderBriefing());
  const waiting = state.activity.filter((a) => a.status === 'proposed').length;
  if (waiting) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `${waiting} action${waiting === 1 ? '' : 's'} waiting for your approval. `),
      'Preview mode is on, so Pilot proposes automatic actions instead of doing them.',
      h('div', { class: 'actions' }, btn('Review in Activity', () => go('activity'), 'primary'))));
  }

  const open = state.updates.filter((u) => u.status !== 'done');
  const done = state.updates.filter((u) => u.status === 'done');
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
    h('button', { class: tab === 'open' ? 'active' : '', onclick: () => { tab = 'open'; render(); } }, `Open (${open.length})`),
    h('button', { class: tab === 'done' ? 'active' : '', onclick: () => { tab = 'done'; render(); } }, `Done (${done.length})`),
    h('button', { class: 'keys-hint', title: 'Keyboard shortcuts', onclick: () => { showKeys = true; document.body.append(keysOverlay()); } }, 'Shortcuts: ?')));

  if (tab === 'done') {
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

function renderBriefing(): HTMLElement {
  const b = state.briefing;
  const today = b && new Date(b.at).toDateString() === new Date().toDateString();
  const again = btn(today ? 'Brief me again' : 'Brief me now', () => void run(() => api.briefNow()), 'ghost');
  if (!today) {
    return h('div', { class: 'banner briefing' },
      h('div', { class: 'briefing-head' }, h('strong', {}, "Today's briefing"), again),
      h('p', { class: 'hint' },
        state.settings.briefing.enabled
          ? `Your Pilot briefs you every morning at ${state.settings.briefing.time}.`
          : 'Morning briefings are off. Turn them on in Settings.'));
  }
  return h('div', { class: 'banner briefing' },
    h('div', { class: 'briefing-head' }, h('strong', {}, "Today's briefing"), h('span', { class: 'hint' }, relTime(b.at)), again),
    h('p', {}, b.text));
}

function openReply(u: Update): void {
  const sig = accountOf(u)?.permissions.signature.trim();
  if (!editors.has(u.key)) editors.set(u.key, (u.triage?.draftReply ?? '') + (sig ? `\n\n${sig}` : ''));
  render();
  document.getElementById(`reply-${u.key}`)?.focus();
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
          ? btn('Snooze till tomorrow', () => quickAct(u, 'snooze'))
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

  return h('article', { class: `card p${t?.priority ?? 0} ${isOpen ? '' : 'done'} ${selectedKey === u.key ? 'selected' : ''}`, 'data-key': u.key },
    h('div', { class: 'card-head' },
      h('span', { class: 'from', title: m.from.email }, m.from.name || m.from.email || 'Unknown sender'),
      t ? h('span', { class: `chip c-${t.category}` }, CAT_LABEL[t.category]) : null,
      h('span', { class: 'meta' }, `${relTime(m.receivedAt)}${state.accounts.length > 1 && account ? ` · ${account.email}` : ''}`)),
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
    remindFor === `u:${u.key}` ? remindBox({ kind: 'update', key: u.key }) : null,
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

const SOURCE_LABEL: Record<TriageSource, string> = {
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

const ACTION_LABEL: Record<ActivityEntry['action'], string> = {
  archive: 'Archive',
  label: 'Label',
  draft: 'Save a reply draft',
  send: 'Send a reply',
  unsubscribe: 'Unsubscribe',
};

function proposalsFor(u: Update): HTMLElement | null {
  const items = state.activity.filter((a) => a.key === u.key && a.status === 'proposed');
  if (!items.length) return null;
  return h('div', { class: 'proposals' }, items.map((a) =>
    h('div', { class: 'proposal' },
      h('span', {}, h('strong', {}, `Pilot proposes: ${ACTION_LABEL[a.action]}${a.category ? ` as ${CAT_LABEL[a.category]}` : ''}`), ` · ${a.reason}`),
      btn(a.action === 'send' ? 'Approve and send' : 'Approve', () => void run(() => api.approve(a.id), 'Done'), 'primary tiny'),
      btn('Reject', () => void run(() => api.reject(a.id)), 'tiny'))));
}

// ---- deadlines, bills and key dates ----

const KIND_LABEL: Record<KeyItemKind, string> = {
  bill: 'Bill',
  deadline: 'Deadline',
  appointment: 'Appointment',
  event: 'Event',
  delivery: 'Delivery',
  other: 'Date',
};

const fmtMoney = (i: Pick<KeyItem, 'amount' | 'currency'>) =>
  i.amount === undefined ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: i.currency || 'USD' }).format(i.amount);

function fmtWhen(i: Pick<KeyItem, 'at' | 'allDay'>): string {
  if (i.at === undefined) return 'No date';
  const d = new Date(i.at);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  return i.allDay ? date : `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** End of day for all-day items, so "due today" isn't overdue until tonight. */
function deadlineOf(i: KeyItem): number {
  if (i.at === undefined) return Infinity;
  if (!i.allDay) return i.at;
  const d = new Date(i.at);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function itemsDueSoon(): number {
  const soon = Date.now() + 3 * 86_400_000;
  return state.items.filter((i) => i.status === 'open' && i.at !== undefined && i.at <= soon).length;
}

const CONFIDENCE: Record<KeyItem['confidence'], [string, string]> = {
  high: ['Stated in the email', 'on'],
  medium: ['Check the details', 'warn'],
  low: ['AI guess', 'bad'],
};

function keyDates(u: Update): HTMLElement | null {
  const items = state.items.filter((i) => i.status === 'open' && i.sourceKeys.includes(u.key));
  if (!items.length) return null;
  return h('div', { class: 'key-dates' }, items.map((i) =>
    h('span', { class: `key-chip c-${i.confidence}`, title: i.notes.join(' ') || CONFIDENCE[i.confidence][0] },
      `${KIND_LABEL[i.kind]}: ${i.title} · ${fmtWhen(i)}${i.amount !== undefined ? ` · ${fmtMoney(i)}` : ''}`)));
}

let deadlineKind: KeyItemKind | 'all' = 'all';
const showEvidence = new Set<string>();

function renderDeadlines(): HTMLElement {
  const wrap = h('div');
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const open = state.items.filter((i) => i.status === 'open' && (deadlineKind === 'all' || i.kind === deadlineKind));
  wrap.append(h('p', { class: 'hint' },
    'Dates and amounts Pilot found in your email. Each one is checked against the email text: "Stated in the email" means the date and amount appear word for word; anything else is marked so you can check it. Pilot never pays bills or moves money.'));
  const kinds = ['all', ...new Set(state.items.filter((i) => i.status === 'open').map((i) => i.kind))] as (KeyItemKind | 'all')[];
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
  const done = state.items.filter((i) => i.status === 'done');
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
      remindFor === `i:${i.id}` ? remindBox({ kind: 'item', id: i.id }) : null),
    h('div', { class: 'row' },
      btn('Done', () => void run(() => api.setItem(i.id, 'done')), 'primary'),
      btn('Remind me…', () => openRemind(`i:${i.id}`)),
      btn(open ? 'Hide source' : 'Show source', () => { if (!showEvidence.delete(i.id)) showEvidence.add(i.id); render(); }, 'ghost'),
      btn('Open email', () => void run(() => api.open(i.key)), 'ghost'),
      btn('Not relevant', () => void run(() => api.setItem(i.id, 'dismissed')), 'ghost')));
}

// ---- ask my inbox ----

let askText = '';
let askHits: SearchHit[] = [];
let askTerms: string[] = [];
let askSemantic = false;
let askAnswer: AskResult | null = null;
let askBusy = false;
let askOpenSource: number | null = null;
let askTimer: number | undefined;

const ASK_EXAMPLES = [
  'What did Tennessee Tech say about admissions?',
  'When is my next deadline?',
  'What did I promise to send?',
  'Find the email where someone mentioned a refund',
  'from:chase last month',
];

function runSearch(): void {
  clearTimeout(askTimer);
  askTimer = window.setTimeout(async () => {
    if (!askText.trim()) {
      askHits = [];
      renderAskResults();
      return;
    }
    const r = await api.search(askText);
    askHits = r.hits;
    askTerms = r.terms;
    askSemantic = r.semantic;
    renderAskResults();
  }, 150);
}

function submitAsk(): void {
  if (!askText.trim() || askBusy) return;
  askBusy = true;
  askAnswer = null;
  askOpenSource = null;
  renderAskResults();
  void run(async () => {
    try {
      askAnswer = await api.ask(askText);
      askHits = askAnswer.results;
    } finally {
      askBusy = false;
      renderAskResults();
    }
  });
}

/** Wraps matched words in <mark>, building nodes (never HTML strings) because snippets are email text. */
function highlight(text: string, terms: string[]): (string | HTMLElement)[] {
  if (!terms.length) return [text];
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*`, 'gi');
  const out: (string | HTMLElement)[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index), h('mark', {}, m[0]));
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** The answer text with [n] markers turned into clickable source chips. */
function answerWithChips(a: AskResult): HTMLElement {
  const p = h('p', { class: 'answer-text' });
  let last = 0;
  for (const m of a.answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    p.append(a.answer.slice(last, m.index));
    for (const n of m[1].split(',').map(Number)) {
      p.append(h('button', { class: `cite ${askOpenSource === n ? 'active' : ''}`, type: 'button', onclick: () => { askOpenSource = askOpenSource === n ? null : n; renderAskResults(); } }, String(n)));
    }
    last = m.index! + m[0].length;
  }
  p.append(a.answer.slice(last));
  return p;
}

function renderAskAnswer(): HTMLElement | null {
  if (askBusy) return h('div', { class: 'banner answer' }, h('div', { class: 'hint' }, 'Reading the matching emails and writing an answer on your PC…'));
  const a = askAnswer;
  if (!a) return null;
  const badge = a.verified
    ? h('span', { class: 'pill on' }, `Based on ${a.citations.length} source${a.citations.length === 1 ? '' : 's'}`)
    : a.found
      ? h('span', { class: 'pill warn' }, 'No sources cited: double-check')
      : h('span', { class: 'pill off' }, 'Not in your email');
  return h('div', { class: 'banner answer' },
    h('div', { class: 'answer-head' }, h('strong', {}, 'Answer'), badge, h('span', { class: 'hint' }, `${(a.ms / 1000).toFixed(1)}s · on this PC${a.semantic ? ' · semantic search' : ''}`)),
    answerWithChips(a),
    a.citations.length
      ? h('div', { class: 'sources' }, a.citations.map((c) =>
          h('div', { class: `source ${askOpenSource === c.n ? 'open' : ''}` },
            h('button', { class: 'source-head', type: 'button', onclick: () => { askOpenSource = askOpenSource === c.n ? null : c.n; renderAskResults(); } },
              h('span', { class: 'cite' }, String(c.n)),
              h('span', { class: 'grow' }, h('strong', {}, c.title), h('span', { class: 'hint' }, ` · ${c.kind === 'email' ? c.from : c.kind === 'item' ? 'tracked date' : 'your commitment'} · ${new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`))),
            askOpenSource === c.n
              ? h('div', { class: 'source-body' },
                  h('blockquote', { class: 'evidence' }, ...highlight(c.excerpt, askTerms)),
                  c.key ? h('div', { class: 'actions' }, btn('Open email', () => void run(() => api.open(c.key!)), 'ghost')) : null)
              : null)))
      : null);
}

function renderAskResultsList(): HTMLElement {
  if (!askText.trim()) {
    return h('div', { class: 'ask-examples' }, h('div', { class: 'hint' }, 'Try:'), ASK_EXAMPLES.map((ex) =>
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { askText = ex; const i = document.querySelector<HTMLInputElement>('.ask-input'); if (i) i.value = ex; runSearch(); submitAsk(); } }, ex)));
  }
  if (!askHits.length) return h('div', { class: 'empty small' }, 'No matching emails.');
  return h('div', {},
    h('h3', { class: 'section' }, `Matching emails (${askHits.length})${askSemantic ? ' · keyword + semantic' : ''}`),
    askHits.map((r) => h('div', { class: 'banner sub-row' },
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, r.subject || '(no subject)'), h('span', { class: 'hint' }, ` · ${r.from} · ${relTime(r.at)}`)),
        h('div', { class: 'hint snippet' }, ...highlight(r.snippet, askTerms))),
      btn('Open', () => void run(() => api.open(r.key)), 'ghost'))));
}

function renderAskResults(): void {
  const box = document.getElementById('ask-results');
  if (!box) return;
  box.replaceChildren(...[renderAskAnswer(), renderAskResultsList()].filter((x): x is HTMLElement => !!x));
}

function renderAsk(): HTMLElement {
  const input = h('input', {
    class: 'ask-input',
    type: 'search',
    value: askText,
    placeholder: 'Ask anything about your email, or search: from:dana lease last month',
    oninput: (e: Event) => { askText = valueOf(e); askAnswer = null; runSearch(); },
  });
  const wrap = h('div', { class: 'ask' },
    h('form', { class: 'ask-form', onsubmit: (e: Event) => { e.preventDefault(); submitAsk(); } },
      input, h('button', { class: 'btn primary', type: 'submit' }, 'Ask')),
    h('div', { class: 'hint' },
      `Matching emails appear as you type. Ask gets an answer from your local AI, using only your email and citing it. Nothing leaves this PC.${state.search.semantic ? '' : ' Semantic search is off (see Settings).'}`),
    h('div', { id: 'ask-results' }));
  setTimeout(() => { renderAskResults(); input.focus(); });
  return wrap;
}

// ---- keyboard ----

let selectedKey: string | null = null;
let showKeys = false;

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous email'],
  ['e', 'Archive'],
  ['d', 'Done'],
  ['s', 'Snooze till tomorrow'],
  ['r', 'Reply'],
  ['o', 'Open in your mail'],
  ['Ctrl+K', 'Ask my inbox'],
  ['g then u / t / d', 'Go to Updates / Today / Deadlines'],
  ['?', 'Show these shortcuts'],
];

function visibleCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('article.card[data-key]')].filter((el) => el.offsetParent !== null);
}

function select(key: string | null): void {
  selectedKey = key;
  for (const el of document.querySelectorAll('article.card.selected')) el.classList.remove('selected');
  const el = key ? document.querySelector<HTMLElement>(`article.card[data-key="${CSS.escape(key)}"]`) : null;
  el?.classList.add('selected');
  el?.scrollIntoView({ block: 'nearest' });
}

function keysOverlay(): HTMLElement {
  return h('div', { class: 'keys-overlay', onclick: () => { showKeys = false; document.querySelector('.keys-overlay')?.remove(); } },
    h('div', { class: 'keys-box' },
      h('h3', {}, 'Keyboard shortcuts'),
      h('table', {}, SHORTCUTS.map(([k, what]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, what)))),
      h('div', { class: 'hint' }, 'Press Esc or click anywhere to close.')));
}

let pendingG = 0;

document.addEventListener('keydown', (e) => {
  if (!state?.settings.onboarded) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    go('ask');
    return;
  }
  const el = document.activeElement;
  const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;
  if (e.key === 'Escape') {
    if (showKeys) {
      showKeys = false;
      document.querySelector('.keys-overlay')?.remove();
    } else if (typing) {
      (el as HTMLElement).blur();
    }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

  if (Date.now() - pendingG < 1500) {
    pendingG = 0;
    const dest = ({ u: 'updates', t: 'today', d: 'deadlines', a: 'activity', f: 'followups' } as Record<string, View>)[e.key];
    if (dest) go(dest);
    return;
  }
  if (e.key === 'g') {
    pendingG = Date.now();
    return;
  }
  if (e.key === '?') {
    showKeys = !showKeys;
    document.querySelector('.keys-overlay')?.remove();
    if (showKeys) document.body.append(keysOverlay());
    return;
  }

  const cards = visibleCards();
  const at = cards.findIndex((c) => c.dataset.key === selectedKey);
  if (e.key === 'j' || e.key === 'k') {
    if (!cards.length) return;
    const next = at < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, at + (e.key === 'j' ? 1 : -1)));
    select(cards[next].dataset.key ?? null);
    e.preventDefault();
    return;
  }
  const u = at >= 0 ? state.updates.find((x) => x.key === selectedKey) : undefined;
  if (!u) return;
  const after = cards[at + 1]?.dataset.key ?? cards[at - 1]?.dataset.key ?? null;
  const moveOn = () => { selectedKey = after; };
  switch (e.key) {
    case 'e':
      if (accountOf(u)?.permissions.manage && u.status !== 'done') { moveOn(); quickAct(u, 'archive'); }
      else toast('Archiving is turned off for this mailbox.');
      break;
    case 'd':
      if (u.status !== 'done') { moveOn(); quickAct(u, 'done'); }
      break;
    case 's':
      if (u.status === 'new') { moveOn(); quickAct(u, 'snooze'); }
      break;
    case 'r':
      e.preventDefault();
      openReply(u);
      break;
    case 'o':
      void run(() => api.open(u.key));
      break;
  }
});

// ---- notifications ----

const EVENT_LABEL: Record<NotifyEvent, string> = {
  urgent: 'Important emails',
  reminder: 'Reminders',
  briefing: 'Morning briefing',
  deadline: 'Bills and deadlines (24 hours ahead)',
  followup: 'Follow-ups that are due',
  reply: 'Replies you were waiting on',
  approval: 'Actions waiting for approval',
};

const LEVEL_LABEL: Record<PrivacyLevel, string> = {
  minimal: 'Minimal: no email details',
  sender: 'Sender and subject',
  full: 'Full: include the summary',
};

/** What an important-email notification looks like at each level (example data). */
const LEVEL_PREVIEW: Record<PrivacyLevel, string> = {
  minimal: 'Pilot · Important email — You have an important new email.',
  sender: 'Pilot · Important email — Chase · "Your payment is overdue"',
  full: 'Pilot · Important email — Chase · "Your payment is overdue" — Your card payment of $84.50 is overdue; pay by Friday.',
};

const ns = () => state.settings.notifications;

function saveNotifications(patch: Partial<NotificationSettings>, done?: string): void {
  void run(() => api.saveSettings({ notifications: { ...ns(), ...patch } }), done);
}

function saveChannel<C extends NotifyChannel>(c: C, patch: Partial<NotificationSettings[C]>, done?: string): void {
  saveNotifications({ [c]: { ...ns()[c], ...patch } } as Partial<NotificationSettings>, done);
}

function toggleRow(label: string, checked: boolean, onchange: (v: boolean) => void, hint?: string): HTMLElement {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }),
    h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null));
}

function channelStatusLine(c: NotifyChannel): HTMLElement | null {
  const st = state.notifier.channels[c];
  if (st.lastError) return h('div', { class: 'err' }, `Last attempt failed: ${st.lastError}`);
  if (st.lastSentAt) return h('div', { class: 'hint' }, `Last sent ${relTime(st.lastSentAt)}.`);
  return null;
}

function channelCard(c: NotifyChannel, title: string, intro: HTMLElement | null, setup: (HTMLElement | null)[]): HTMLElement {
  const ch = ns()[c];
  const level = h('select', { onchange: (e: Event) => saveChannel(c, { level: (e.target as HTMLSelectElement).value as PrivacyLevel }) },
    (Object.keys(LEVEL_LABEL) as PrivacyLevel[]).map((l) => h('option', { value: l, selected: ch.level === l }, LEVEL_LABEL[l])));
  return h('fieldset', { class: 'notify-card' }, h('legend', {}, title),
    toggleRow(`Send notifications ${c === 'desktop' ? 'on this PC' : `with ${title}`}`, ch.enabled, (v) => saveChannel(c, { enabled: v })),
    intro,
    ch.enabled ? h('div', {},
      ...setup,
      field('How much to show', level),
      h('div', { class: 'preview' }, h('span', { class: 'hint' }, 'Example: '), LEVEL_PREVIEW[ch.level]),
      c !== 'desktop' && ch.level !== 'minimal'
        ? h('div', { class: 'err' },
            `At this level, email senders and subjects${ch.level === 'full' ? ' and summaries' : ''} pass through ${c === 'ntfy' ? (ns().ntfy.server.includes('ntfy.sh') ? 'the public ntfy.sh servers' : 'your ntfy server') : "Telegram's servers"}. Everything else in Pilot stays on this PC. Keep "Minimal" unless you're comfortable with that.`)
        : null,
      h('div', { class: 'field' }, h('label', {}, 'Notify me about'),
        h('div', { class: 'events' }, (Object.keys(EVENT_LABEL) as NotifyEvent[]).map((ev) =>
          toggleRow(EVENT_LABEL[ev], ch.events[ev], (v) => saveChannel(c, { events: { ...ch.events, [ev]: v } }))))),
      h('div', { class: 'row' }, btn('Send a test', () => void run(() => api.testNotification(c), 'Test sent. Check your device.'))),
      channelStatusLine(c)) : null);
}

function secretField(c: 'ntfy' | 'telegram', label: string, hint: string): HTMLElement {
  const has = state.notifier.channels[c].hasSecret;
  const input = h('input', { type: 'password', placeholder: has ? 'Saved (hidden). Type to replace.' : '', autocomplete: 'off' });
  return field(label, h('div', { class: 'row' }, input,
    btn('Save', () => void run(async () => { await api.setChannelSecret(c, input.value); input.value = ''; }, 'Saved securely on this PC')),
    has ? btn('Remove', () => void run(() => api.setChannelSecret(c, ''), 'Removed'), 'ghost') : null), hint);
}

function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `pilot-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;
}

function renderNotifications(): HTMLElement {
  const n = ns();
  const b = state.settings.briefing;
  const wrap = h('div', { class: 'settings' });

  wrap.append(
    h('fieldset', {}, h('legend', {}, 'All notifications'),
      toggleRow('Notifications on', n.enabled, (v) => saveNotifications({ enabled: v }), 'Turn everything off here; your settings below are kept.'),
      state.notifier.held ? h('div', { class: 'hint' }, `${state.notifier.held} notification${state.notifier.held === 1 ? ' is' : 's are'} held and will arrive as one summary after quiet hours.`) : null),

    h('fieldset', {}, h('legend', {}, 'Quiet hours'),
      toggleRow('Hold notifications during quiet hours', n.quiet.enabled, (v) => saveNotifications({ quiet: { ...n.quiet, enabled: v } }),
        'Anything that comes in is sent as one short summary when quiet hours end.'),
      h('div', { class: 'row' },
        field('From', h('input', { type: 'time', value: n.quiet.start, onchange: (e: Event) => saveNotifications({ quiet: { ...n.quiet, start: valueOf(e) || '22:00' } }) })),
        field('Until', h('input', { type: 'time', value: n.quiet.end, onchange: (e: Event) => saveNotifications({ quiet: { ...n.quiet, end: valueOf(e) || '07:00' } }) }))),
      toggleRow('Let important emails through anyway', n.quiet.allowUrgent, (v) => saveNotifications({ quiet: { ...n.quiet, allowUrgent: v } }))),

    h('fieldset', {}, h('legend', {}, 'Morning briefing'),
      toggleRow('Send a daily briefing', b.enabled, (v) => void run(() => api.saveSettings({ briefing: { ...b, enabled: v } }))),
      h('div', { class: 'row' },
        field('Time', h('input', { type: 'time', value: b.time, onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...b, time: valueOf(e) || '08:00' } })) })),
        field('Days', h('select', { onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...b, days: (e.target as HTMLSelectElement).value as 'everyday' | 'weekdays' } })) },
          h('option', { value: 'everyday', selected: b.days === 'everyday' }, 'Every day'),
          h('option', { value: 'weekdays', selected: b.days === 'weekdays' }, 'Weekdays only')))),
      h('div', { class: 'field' }, h('label', {}, 'Include'),
        (Object.entries({ urgent: 'What needs you', deadlines: 'Bills and deadlines', followups: 'Follow-ups', approvals: 'Approvals waiting' }) as [keyof typeof b.sections, string][]).map(([k, label]) =>
          toggleRow(label, b.sections[k], (v) => void run(() => api.saveSettings({ briefing: { ...b, sections: { ...b.sections, [k]: v } } }))))),
      h('div', { class: 'hint' }, 'Which devices get the briefing is set per channel below ("Morning briefing"). On phones at Minimal or Sender level, the briefing shows counts only.')),

    channelCard('desktop', 'This PC', null, []),

    channelCard('ntfy', 'ntfy (phone)',
      h('p', { class: 'hint' },
        'Free push notifications to the ntfy app (Android, iPhone). Install ntfy on your phone and subscribe to the topic below. ntfy.sh is a public relay: anyone who knows the topic name can read it, so Pilot makes a hard-to-guess name and the default "Minimal" level sends no email details. For fully private delivery, run your own ntfy server and enter its address.'),
      [
        field('Server', h('input', { type: 'text', value: n.ntfy.server, onchange: (e: Event) => saveChannel('ntfy', { server: valueOf(e).trim() || 'https://ntfy.sh' }) })),
        field('Topic', h('div', { class: 'row' },
          h('input', { type: 'text', value: n.ntfy.topic, placeholder: 'pilot-…', onchange: (e: Event) => saveChannel('ntfy', { topic: valueOf(e).trim().replace(/[^\w-]/g, '').slice(0, 64) }) }),
          btn('Generate', () => saveChannel('ntfy', { topic: randomTopic() }, 'New topic set. Subscribe to it in the ntfy app.'))),
          n.ntfy.topic ? `In the ntfy app, tap + and subscribe to "${n.ntfy.topic}"${n.ntfy.server !== 'https://ntfy.sh' ? ` on ${n.ntfy.server}` : ''}.` : 'Generate a topic, then subscribe to it in the ntfy app.'),
        secretField('ntfy', 'Access token (optional)', 'Only needed for a protected topic or your own server. Stored encrypted on this PC.'),
        field('Phone notifications per hour', h('input', { type: 'number', value: String(n.maxPerHour), onchange: (e: Event) => saveNotifications({ maxPerHour: Math.max(1, Math.min(60, Number(valueOf(e)) || 10)) }) }),
          'Beyond this, the rest arrive together as one summary. Applies to ntfy and Telegram together.'),
      ]),

    channelCard('telegram', 'Telegram (phone)',
      h('p', { class: 'hint' }, 'Messages from your own Telegram bot. They pass through Telegram\'s servers, so keep "Minimal" unless you are comfortable with that.'),
      [
        h('ol', { class: 'steps' },
          h('li', {}, 'In Telegram, message @BotFather, send /newbot, and copy the token it gives you.'),
          h('li', {}, 'Paste the token below and save.'),
          h('li', {}, 'Open your new bot in Telegram and press Start.'),
          h('li', {}, 'Click "Find my chat".')),
        secretField('telegram', 'Bot token', 'Stored encrypted on this PC; never shown again.'),
        field('Chat', h('div', { class: 'row' },
          h('span', { class: 'hint' }, n.telegram.chatId ? `Connected (chat ${n.telegram.chatId})` : 'Not connected yet'),
          btn('Find my chat', () => void run(async () => {
            const r = await api.detectTelegramChat();
            toast(`Connected to ${r.name}.`);
          })))),
      ]),
  );
  return wrap;
}

// ---- today: the command center ----

function greeting(): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return state.settings.userName ? `${part}, ${state.settings.userName}` : part;
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
  for (const i of state.items.filter((x) => x.status === 'open' && x.at !== undefined && x.at <= until)) {
    out.push({ at: i.at!, allDay: i.allDay, label: KIND_LABEL[i.kind], title: `${i.title}${i.amount !== undefined ? ` · ${fmtMoney(i)}` : ''}`, detail: i.sender, overdue: deadlineOf(i) < now, go: 'deadlines' });
  }
  for (const c of state.commitments.filter((x) => x.status === 'open' && x.dueAt && x.dueAt <= until)) {
    out.push({ at: c.dueAt!, allDay: false, label: 'You promised', title: c.text, detail: c.withWhom ?? '', overdue: c.dueAt! < now, go: 'followups' });
  }
  for (const f of state.followUps.filter((x) => x.status === 'waiting' && x.dueAt <= until)) {
    out.push({ at: f.dueAt, allDay: false, label: 'Follow up', title: f.subject || '(no subject)', detail: f.to.email, overdue: f.dueAt < now, go: 'followups' });
  }
  for (const r of state.reminders.filter((x) => (x.status === 'pending' && x.at <= until) || x.status === 'due')) {
    out.push({ at: r.at, allDay: false, label: 'Reminder', title: r.title, detail: `"${r.phrase}"`, overdue: r.status === 'due', go: 'followups' });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.at - b.at);
}

function tile(value: number, label: string, target: View, warn = false): HTMLElement {
  return h('button', { class: `tile ${warn && value ? 'warn' : ''}`, type: 'button', onclick: () => go(target) },
    h('div', { class: 'tile-value' }, String(value)),
    h('div', { class: 'tile-label' }, label));
}

function renderToday(): HTMLElement {
  const wrap = h('div', { class: 'today' });
  const open = state.updates.filter((u) => u.status === 'new');
  const needYou = open.filter((u) => u.triage?.priority === 1);
  const items = agenda();
  const waitingOn = state.followUps.filter((f) => f.status === 'waiting');
  const proposed = state.activity.filter((a) => a.status === 'proposed').length;

  for (const a of state.accounts.filter((x) => x.needsReconnect && x.kind !== 'imap')) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `${a.email} needs to be reconnected. `), 'The sign-in expired (Google does this weekly while the app is in Testing). Your data is kept.',
      h('div', { class: 'actions' }, btn('Reconnect', () =>
        void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: a.calendar }), 'Reconnected. Checking mail…'), 'primary'))));
  }
  const up = state.app.update;
  if (up?.available && up.url) {
    wrap.append(h('div', { class: 'banner approve-banner' },
      h('strong', {}, `Pilot ${up.latest} is available. `), `You have ${state.app.version}.`,
      h('div', { class: 'actions' }, btn('Download', () => void run(() => api.openUrl(up.url!)), 'primary'))));
  }
  wrap.append(h('div', { class: 'today-head' },
    h('h2', {}, greeting()),
    h('div', { class: 'hint' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))));

  if (!state.accounts.some((a) => a.watching)) {
    wrap.append(h('div', { class: 'banner' }, h('strong', {}, "Pilot isn't watching any mailbox yet. "),
      h('div', { class: 'actions' }, btn('Go to Mailboxes', () => go('mailboxes'), 'primary'))));
    return wrap;
  }

  wrap.append(h('div', { class: 'tiles' },
    tile(needYou.length, 'need you today', 'updates', true),
    tile(items.filter((a) => a.overdue).length, 'overdue', 'deadlines', true),
    tile(state.owed.length, 'replies you owe', 'followups'),
    tile(waitingOn.length, 'waiting on others', 'followups'),
    tile(proposed, 'awaiting approval', 'activity', true)));

  wrap.append(renderBriefing());

  wrap.append(h('h3', { class: 'section' }, 'Needs you now'));
  if (!needYou.length) wrap.append(h('div', { class: 'empty small' }, 'Nothing urgent.'));
  for (const u of needYou.slice(0, 5)) {
    wrap.append(h('button', { class: 'today-row', type: 'button', onclick: () => { tab = 'open'; go('updates'); } },
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

  if (state.owed.length || waitingOn.length) {
    wrap.append(h('h3', { class: 'section' }, 'Conversations'));
    for (const o of state.owed.slice(0, 3)) {
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
  return wrap;
}

// ---- follow-ups ----

/** Which item's "Remind me…" box is open, as "u:<key>", "f:<id>" or "c:<id>". */
let remindFor: string | null = null;
let remindText = '';
let remindPreview = '';

function openRemind(id: string): void {
  remindFor = remindFor === id ? null : id;
  remindText = '';
  remindPreview = '';
  render();
  document.querySelector<HTMLInputElement>('.remind-box input')?.focus();
}

function dueCount(): number {
  const now = Date.now();
  return (
    state.owed.filter((o) => o.overdue).length +
    state.followUps.filter((f) => f.status === 'waiting' && f.dueAt <= now).length +
    state.commitments.filter((c) => c.status === 'open' && c.dueAt && c.dueAt <= now).length +
    state.reminders.filter((r) => r.status === 'due').length
  );
}

/** Natural-language reminder input with a live preview of how Pilot read it. */
function remindBox(target: ReminderTarget): HTMLElement {
  const preview = h('div', { class: 'hint remind-preview' }, remindPreview || 'Try "Friday", "tomorrow at 3pm", "in 2 days" or "Monday if they haven\'t replied".');
  let timer: number | undefined;
  const input = h('input', {
    type: 'text',
    value: remindText,
    placeholder: 'Remind me…',
    oninput: (e: Event) => {
      remindText = valueOf(e);
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!remindText.trim()) return;
        const r = await api.previewWhen(remindText);
        remindPreview = 'error' in r ? r.error : `Pilot will remind you ${r.label}.`;
        preview.textContent = remindPreview;
        preview.classList.toggle('err', 'error' in r);
      }, 250);
    },
  });
  return h('form', { class: 'remind-box', onsubmit: (e: Event) => {
    e.preventDefault();
    void run(async () => {
      await api.remind(target, remindText);
      remindFor = null;
      render();
    }, 'Reminder set');
  } },
    h('div', { class: 'row' }, input,
      h('button', { class: 'btn primary', type: 'submit' }, 'Set reminder'),
      btn('Cancel', () => { remindFor = null; render(); }, 'ghost')),
    preview);
}

const dayLabel = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function renderFollowUps(): HTMLElement {
  const wrap = h('div');
  const now = Date.now();
  const waiting = state.followUps.filter((f) => f.status === 'waiting');
  const commitments = state.commitments.filter((c) => c.status === 'open');
  const dueReminders = state.reminders.filter((r) => r.status === 'due');
  const pending = state.reminders.filter((r) => r.status === 'pending');
  const resolved = [
    ...state.followUps.filter((f) => f.status === 'replied').map((f) => ({ at: f.repliedAt ?? f.sentAt, text: `${f.to.email} replied to "${f.subject}"` })),
    ...state.reminders.filter((r) => r.status === 'resolved').map((r) => ({ at: r.at, text: `Skipped reminder "${r.title}": ${r.note}` })),
  ].sort((a, b) => b.at - a.at);

  wrap.append(h('p', { class: 'hint' },
    `Pilot reads your sent mail for questions you're waiting on and promises you made, and checks the real conversation for replies before anything shows as overdue. Nudge after ${state.settings.followUpDays} working days (change in Settings).`));

  if (dueReminders.length) {
    wrap.append(h('h3', { class: 'section' }, `Reminders due (${dueReminders.length})`));
    for (const r of dueReminders) wrap.append(reminderRow(r));
  }

  const owed = state.owed;
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
      remindFor === `u:${o.key}` ? remindBox({ kind: 'update', key: o.key }) : null),
    h('div', { class: 'row' },
      btn('Reply', () => { tab = 'open'; go('updates'); }),
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
      remindFor === `f:${f.id}` ? remindBox({ kind: 'followup', id: f.id }) : null),
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
      remindFor === `c:${c.id}` ? remindBox({ kind: 'commitment', id: c.id }) : null),
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

// ---- activity ----

let activityFilter: 'waiting' | 'all' = 'waiting';

const IRREVERSIBLE: Partial<Record<ActivityEntry['action'], string>> = {
  send: "Sent mail can't be recalled.",
  draft: 'Delete the draft in your mailbox if you no longer want it.',
  unsubscribe: "Can't be reversed here; re-subscribe on the sender's site.",
};

function renderActivity(): HTMLElement {
  const wrap = h('div');
  const waiting = state.activity.filter((a) => a.status === 'proposed');
  if (activityFilter === 'waiting' && !waiting.length) activityFilter = 'all';
  wrap.append(h('p', { class: 'hint' },
    state.settings.previewMode
      ? 'Preview mode is on: automatic actions wait here for your approval. Turn it off in Settings once you trust them.'
      : 'Everything Pilot did, newest first. Archive and label can be undone.'));
  wrap.append(h('div', { class: 'tabs' },
    h('button', { class: activityFilter === 'waiting' ? 'active' : '', onclick: () => { activityFilter = 'waiting'; render(); } }, `Waiting for approval (${waiting.length})`),
    h('button', { class: activityFilter === 'all' ? 'active' : '', onclick: () => { activityFilter = 'all'; render(); } }, `All (${state.activity.length})`)));
  const list = activityFilter === 'waiting' ? waiting : state.activity;
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
  const account = state.accounts.find((x) => x.id === a.accountId);
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
        `${relTime(a.at)} · ${a.trigger === 'auto' ? 'Automatic' : 'You'} · ${a.reason}` + (state.accounts.length > 1 && account ? ` · ${account.email}` : '')),
      a.error ? h('div', { class: 'err' }, a.error) : null,
      a.replyText ? h('pre', { class: 'original' }, a.replyText) : null,
      a.status === 'done' && !a.undoable && IRREVERSIBLE[a.action] ? h('div', { class: 'hint' }, IRREVERSIBLE[a.action]!) : null),
    h('div', { class: 'row' }, controls));
}

// ---- sorting rules ----

const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Always important', 2: 'Normal', 3: 'Always low priority' };

function ruleEffectLabel(e: Rule['effect']): string {
  if (e.hide) return 'Hide (move to Done)';
  return e.priority ? PRIORITY_LABEL[e.priority] : e.category ? `Always ${CAT_LABEL[e.category]}` : 'No change';
}

function renderSorting(): HTMLElement {
  const wrap = h('div');
  wrap.append(h('p', { class: 'hint' },
    'Rules always win over the AI. Teach Pilot from any email ("Always from this sender…"), or add a rule here. A single "More/Less important" click only changes that one email; after two similar corrections, or when you keep archiving or replying to a sender, Pilot suggests a rule.'));

  if (state.suggestedRules.length) {
    wrap.append(h('h3', { class: 'section' }, 'Suggested'));
    for (const s of state.suggestedRules) wrap.append(suggestedRow(s));
  }

  wrap.append(plainRuleBox());

  wrap.append(h('h3', { class: 'section' }, `Your rules (${state.rules.length})`));
  if (!state.rules.length) wrap.append(h('div', { class: 'empty' }, 'No rules yet.'));
  for (const r of state.rules) wrap.append(ruleRow(r));

  const who = h('input', { type: 'text', placeholder: 'person@company.com or @company.com' });
  const effect = h('select', {},
    h('option', { value: '1' }, 'Always important'),
    h('option', { value: '3' }, 'Always low priority'),
    h('option', { value: 'hide' }, 'Hide (move to Done)'));
  wrap.append(h('form', { class: 'banner add-rule', onsubmit: (e: Event) => {
    e.preventDefault();
    const v = who.value.trim().toLowerCase();
    const match = v.startsWith('@') ? { domain: v.slice(1) } : { sender: v };
    void run(() => api.saveRule({ enabled: true, match, effect: effectFrom(effect.value), origin: 'manual' }), 'Rule added');
  } },
    h('h3', {}, 'Add a rule'),
    h('div', { class: 'row' }, who, effect, h('button', { class: 'btn primary', type: 'submit' }, 'Add'))));
  return wrap;
}

function effectFrom(v: string): Rule['effect'] {
  return v === 'hide' ? { priority: 3, hide: true } : { priority: Number(v) as Priority };
}

let ruleText = '';
let rulePreview: RulePreview | null = null;
let ruleBusy = false;

/** "Describe a rule": the model reads the sentence, you see what it would change, nothing is saved until you say so. */
function plainRuleBox(): HTMLElement {
  const input = h('input', {
    type: 'text',
    value: ruleText,
    placeholder: 'e.g. emails from billing@acme.com are important · hide anything with "webinar" in the subject',
    oninput: (e: Event) => { ruleText = (e.target as HTMLInputElement).value; rulePreview = null; },
  });
  const preview = () => {
    if (!ruleText.trim() || ruleBusy) return;
    ruleBusy = true;
    render();
    void run(async () => {
      try {
        rulePreview = await api.parseRule(ruleText);
      } finally {
        ruleBusy = false;
        render();
      }
    });
  };
  const p = rulePreview;
  return h('form', { class: 'banner add-rule', onsubmit: (e: Event) => { e.preventDefault(); preview(); } },
    h('h3', {}, 'Describe a rule'),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit', disabled: ruleBusy }, ruleBusy ? 'Reading…' : 'Preview')),
    h('div', { class: 'hint' }, 'Rules only sort your mail (important, low priority or hidden). They never send, delete or unsubscribe.'),
    p
      ? h('div', { class: 'rule-preview' },
          h('div', {}, h('strong', {}, p.description)),
          h('div', { class: 'hint' },
            p.count ? `Would apply to ${p.count} email${p.count === 1 ? '' : 's'} you have now${p.count > 5 ? ', including' : ''}:` : "Doesn't match any email you have now; it will apply to new ones."),
          p.examples.length ? h('ul', { class: 'todos' }, p.examples.map((x) => h('li', {}, `${x.from}: ${x.subject || '(no subject)'}`))) : null,
          h('div', { class: 'actions' },
            btn('Create rule', () => void run(async () => {
              await api.saveRule({ enabled: true, match: p.match, effect: p.effect, origin: 'manual' });
              ruleText = '';
              rulePreview = null;
            }, 'Rule created'), 'primary'),
            btn('Cancel', () => { rulePreview = null; render(); }, 'ghost')))
      : null);
}

function suggestedRow(s: SuggestedRule): HTMLElement {
  return h('div', { class: 'banner sub-row' },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, s.match.sender ?? `@${s.match.domain}`), ` → ${ruleEffectLabel(s.effect)}`),
      h('div', { class: 'hint' }, s.because)),
    btn('Create rule', () => void run(() => api.saveRule({ enabled: true, match: s.match, effect: s.effect, origin: 'suggestion' }), 'Rule created'), 'primary'),
    btn('Not now', () => void run(() => api.dismissSuggestion(s))));
}

function ruleRow(r: Rule): HTMLElement {
  const effect = h('select', {
    onchange: (e: Event) => void run(() => api.saveRule({ ...r, effect: effectFrom((e.target as HTMLSelectElement).value) })),
  },
    h('option', { value: '1', selected: r.effect.priority === 1 && !r.effect.hide }, 'Always important'),
    h('option', { value: '3', selected: r.effect.priority === 3 && !r.effect.hide }, 'Always low priority'),
    h('option', { value: 'hide', selected: !!r.effect.hide }, 'Hide (move to Done)'));
  return h('div', { class: `banner sub-row ${r.enabled ? '' : 'disabled'}` },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, r.match.sender ?? (r.match.domain ? `anyone @${r.match.domain}` : 'anyone')), r.match.subjectContains ? ` · subject contains "${r.match.subjectContains}"` : ''),
      h('div', { class: 'hint' },
        `${r.origin === 'manual' ? 'Added by you' : r.origin === 'suggestion' ? 'From a suggestion' : 'From a correction'} · used ${r.hits} time${r.hits === 1 ? '' : 's'}` +
          (r.lastHitAt ? `, last ${relTime(r.lastHitAt)}` : ''))),
    effect,
    h('label', { class: 'check inline' },
      h('input', { type: 'checkbox', checked: r.enabled, onchange: (e: Event) => void run(() => api.saveRule({ ...r, enabled: (e.target as HTMLInputElement).checked })) }),
      'On'),
    btn('Delete', () => void run(() => api.deleteRule(r.id), 'Rule deleted'), 'ghost danger'));
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

// ---- forms ----

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

function check(label: string, checked: boolean, hint?: string): [HTMLElement, HTMLInputElement] {
  const input = h('input', { type: 'checkbox', checked });
  return [h('label', { class: 'check' }, input, h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null)), input];
}

const text = (value: string, type = 'text') => h('input', { type, value });

function renderRules(): HTMLElement {
  const ar = state.settings.autoReply;
  const catChecks = (['reply', 'action', 'fyi'] as Category[]).map((c) => {
    const [el, input] = check(CAT_LABEL[c], ar.categories.includes(c));
    return { c, el, input };
  });
  const cap = text(String(ar.dailySendCap), 'number');
  const tone = text(ar.tone);
  const [discloseEl, disclose] = check('Add "Sent automatically by my email assistant" to auto-sent replies', ar.disclose);

  return h('form', { class: 'settings', onsubmit: (e: Event) => {
    e.preventDefault();
    const patch: Partial<Settings> = {
      autoReply: {
        categories: catChecks.filter((x) => x.input.checked).map((x) => x.c),
        dailySendCap: Math.max(0, Number(cap.value) || 0),
        tone: tone.value.trim(),
        disclose: disclose.checked,
      },
    };
    void run(() => api.saveSettings(patch), 'Reply rules saved');
  } },
    h('p', { class: 'hint' },
      'These rules apply to every mailbox. Whether a mailbox gets suggestions, drafts or auto-sent replies, and who counts as trusted, is set per mailbox under Mailboxes → Permissions.'),
    h('fieldset', {}, h('legend', {}, 'Which emails get replies'),
      h('p', { class: 'hint' },
        'Pilot only drafts or sends replies for emails it puts in these categories. Newsletters, promotions, automated notifications, mailing lists, no-reply senders and threads already answered are always skipped.'),
      catChecks.map((x) => x.el)),
    h('fieldset', {}, h('legend', {}, 'Safeguards'),
      field('Daily auto-send limit', cap, 'Across all mailboxes. After this many automatic sends in 24 hours, further replies become drafts.'),
      discloseEl),
    h('fieldset', {}, h('legend', {}, 'Voice'),
      field('Tone', tone, 'For example: "Warm and casual" or "Formal, short, no exclamation marks".')),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}

function renderSettings(): HTMLElement {
  const s = state.settings;
  const name = text(s.userName);
  const poll = text(String(s.pollMinutes), 'number');
  const lookback = text(String(s.lookbackHours), 'number');
  const followUpDays = text(String(s.followUpDays), 'number');
  const ollamaUrl = text(s.ollama.url);
  const model = h('input', { type: 'text', value: s.ollama.model, list: 'models' });
  const fastModel = h('input', { type: 'text', value: s.ollama.fastModel, list: 'models', placeholder: 'Same as above' });
  const [encryptEl, encrypt] = check("Encrypt Pilot's data on this PC", s.encryptAtRest,
    'Your summaries, email text and settings are stored encrypted with Windows (DPAPI), like your sign-ins. Only your Windows account can read them.');
  const [loginEl, login] = check('Start Pilot when I sign in to Windows', s.launchAtLogin,
    state.app.packaged ? 'It starts quietly in the tray.' : 'Available in the installed app (not when running from source).');
  if (!state.app.packaged) login.disabled = true;
  const [updCheckEl, updCheck] = check('Check for new versions', s.updates.check, 'Pilot only tells you about an update; installing it is up to you.');
  const feed = text(s.updates.feedUrl);
  const [previewEl, preview] = check('Preview mode: automatic actions wait for my approval', s.previewMode,
    'Labels, auto-archive, auto-replies and auto-unsubscribes are proposed in Activity instead of done. Recommended until you trust them. Replies you send yourself are never affected.');
  const modelList = h('datalist', { id: 'models' });
  const gId = text(s.google.clientId);
  const gSecret = text(s.google.clientSecret, 'password');
  const mId = text(s.microsoft.clientId);
  const mTenant = text(s.microsoft.tenant);

  const loadModels = () =>
    void run(async () => {
      const models = await api.listModels();
      modelList.replaceChildren(...models.map((m) => h('option', { value: m })));
      toast(models.length ? `Ollama has ${models.length} model${models.length === 1 ? '' : 's'} installed` : 'Ollama is running but has no models. Run: ollama pull llama3.1:8b');
    });

  return h('form', { class: 'settings', onsubmit: (e: Event) => {
    e.preventDefault();
    const patch: Partial<Settings> = {
      userName: name.value.trim(),
      pollMinutes: Math.max(1, Number(poll.value) || 5),
      lookbackHours: Math.max(1, Number(lookback.value) || 48),
      followUpDays: Math.min(30, Math.max(1, Number(followUpDays.value) || 3)),
      ollama: { url: ollamaUrl.value.trim(), model: model.value.trim(), fastModel: fastModel.value.trim(), embedModel: s.ollama.embedModel },
      previewMode: preview.checked,
      encryptAtRest: encrypt.checked,
      launchAtLogin: login.checked,
      updates: { check: updCheck.checked, feedUrl: feed.value.trim() },
      google: { clientId: gId.value.trim(), clientSecret: gSecret.value.trim() },
      microsoft: { clientId: mId.value.trim(), tenant: mTenant.value.trim() || 'common' },
    };
    void run(() => api.saveSettings(patch), 'Settings saved');
  } },
    h('fieldset', {}, h('legend', {}, 'You'),
      field('Your name', name, 'This PC has one Pilot, and it works for you.'),
      field('Check for mail every (minutes)', poll),
      field('When a mailbox starts being watched, look back (hours)', lookback),
      field('Suggest a follow-up after (working days without a reply)', followUpDays)),
    h('fieldset', {}, h('legend', {}, 'Automation'), previewEl),
    h('fieldset', {}, h('legend', {}, 'Privacy and startup'), encryptEl, loginEl),
    h('fieldset', {}, h('legend', {}, 'Updates'),
      updCheckEl,
      field('Update feed', feed, 'An https address with the latest version (a GitHub "latest release" link works). Set once releases are published.'),
      h('div', { class: 'row' },
        btn('Check now', () => void run(() => api.checkForUpdates(), 'Checked for updates')),
        h('span', { class: 'hint' },
          state.app.update
            ? state.app.update.error
              ? `Last check failed: ${state.app.update.error}`
              : state.app.update.available
                ? `Version ${state.app.update.latest} is available.`
                : `You're up to date (checked ${relTime(state.app.update.checkedAt)}).`
            : ''))),
    h('fieldset', {}, h('legend', {}, 'Troubleshooting'),
      h('div', { class: 'hint' }, `Inbox Pilot ${state.app.version}${state.app.packaged ? '' : ' (running from source)'}${state.app.devMode ? ' · developer mode: Ctrl+Shift+I opens DevTools' : ''}`),
      h('div', { class: 'row' },
        btn('Open logs folder', () => void run(() => api.openFolder('logs'))),
        btn('Open data folder', () => void run(() => api.openFolder('data')))),
      h('div', { class: 'hint' }, 'Logs never contain email text, addresses or passwords. A backup of your data is kept for each of the last 7 days.')),
    h('fieldset', {}, h('legend', {}, 'Local AI (Ollama)'),
      field('Ollama address', ollamaUrl),
      field('Model', h('div', { class: 'row' }, model, modelList, btn('Find installed', loadModels)),
        'Any chat model you have pulled, such as llama3.1:8b, qwen2.5:7b or gemma4:e4b. If this one is not installed, Pilot switches to one that is.'),
      field('Quick-read model (optional)', fastModel, 'A smaller model for automated mail. Leave blank to use the main model.'),
      semanticField(),
      statsTable()),
    h('details', { class: 'advanced' }, h('summary', {}, 'Advanced: use your own sign-in clients'),
      h('p', { class: 'hint' },
        'Inbox Pilot normally uses the Google and Microsoft sign-in clients built into the app. Fill these in only to use your own.'),
      h('fieldset', {}, h('legend', {}, 'Google'),
        field('OAuth client ID', gId),
        field('OAuth client secret', gSecret)),
      h('fieldset', {}, h('legend', {}, 'Microsoft'),
        field('Application (client) ID', mId),
        field('Tenant', mTenant, '"common" works for personal and work accounts.'))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}

const EMBED_MODEL = 'nomic-embed-text';

/** Semantic search needs a small local embedding model; downloading it is the user's explicit choice. */
function semanticField(): HTMLElement {
  const st = state.search;
  return h('div', { class: 'field' },
    h('label', {}, 'Semantic search for Ask'),
    st.semantic
      ? h('div', { class: 'hint' }, `On, using ${st.model}. ${st.indexed} of ${st.total} emails indexed on this PC.`)
      : h('div', {},
          h('div', { class: 'hint' }, 'Off. Ask uses keyword search, which works well for names and specific words. Semantic search also finds emails that mean the same thing in different words. It needs a small local embedding model.'),
          btn(`Download ${EMBED_MODEL} (about 270 MB) and turn on`, () => {
            if (!confirm(`Download the ${EMBED_MODEL} model (about 270 MB) through Ollama? It runs locally; your email is not sent anywhere.`)) return;
            toast('Downloading… this can take a few minutes.');
            void run(() => api.enableSemantic(EMBED_MODEL), 'Semantic search is on. Indexing your email in the background.');
          })));
}

/** Pipeline metrics: how mail was classified, how fast, and how often you corrected it. */
function statsTable(): HTMLElement {
  const st = state.stats;
  const rows = (['rule', 'fast', 'light', 'full'] as TriageSource[]).map((src) => {
    const b = st.bySource[src];
    const accuracy = b.count ? `${Math.round(100 * (1 - b.corrected / b.count))}%` : '–';
    return h('tr', {},
      h('td', {}, SOURCE_LABEL[src]),
      h('td', {}, String(b.count)),
      h('td', {}, b.count && (src === 'light' || src === 'full') ? `${(b.avgMs / 1000).toFixed(1)}s` : src === 'rule' || src === 'fast' ? 'instant' : '–'),
      h('td', {}, accuracy));
  });
  return h('div', { class: 'field' },
    h('label', {}, 'How your mail was read'),
    h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Stage'), h('th', {}, 'Emails'), h('th', {}, 'Avg time'), h('th', {}, 'Not corrected'))),
      h('tbody', {}, rows)),
    h('div', { class: 'hint' }, `${st.corrections} correction${st.corrections === 1 ? '' : 's'} so far. "Not corrected" is the share you didn't have to fix.`));
}

// ---- boot ----

api.onState(onState);
api.getState().then((s) => {
  state = s;
  if (s.settings.userName) onboardStep = 'mail';
  render();
});
