import type {
  Account,
  AccountPatch,
  AccountPermissions,
  Api,
  AppState,
  Category,
  Discovery,
  ReplyMode,
  ReplyRecord,
  ServerConfig,
  Settings,
  Subscription,
  Update,
} from '../shared/types.js';

declare global {
  interface Window {
    api: Api;
  }
}

type View = 'updates' | 'mailboxes' | 'subscriptions' | 'rules' | 'settings';

const api = window.api;
const root = document.getElementById('app')!;
let state: AppState;
let view: View = 'updates';
let tab: 'open' | 'done' = 'open';
let onboardStep: 'name' | 'mail' = 'name';
/** Reply text being edited, by update key. Survives re-renders. */
const editors = new Map<string, string>();
const showOriginal = new Set<string>();
/** Mailboxes whose permissions panel is expanded. */
const openPerms = new Set<string>();
/** The add-mailbox flow in progress, if any. */
let addFlow: { email: string; busy: string; discovery?: Discovery; password: string } | null = null;
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

function toast(text: string): void {
  const t = document.getElementById('toast')!;
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4500);
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

function render(): void {
  if (!state.settings.onboarded) {
    root.replaceChildren(renderOnboarding());
    return;
  }
  root.replaceChildren(h('div', { class: 'layout' }, renderNav(), h('main', {}, renderHeader(), renderView())));
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
    item('updates', 'Updates', open ? String(open) : undefined),
    item('mailboxes', 'Mailboxes', state.accounts.length ? `${watching}/${state.accounts.length}` : undefined),
    item('subscriptions', 'Subscriptions', suggestions ? String(suggestions) : undefined),
    item('rules', 'Reply rules'),
    item('settings', 'Settings'),
  );
}

function renderHeader(): HTMLElement {
  const titles: Record<View, string> = {
    updates: 'Updates',
    mailboxes: 'Mailboxes',
    subscriptions: 'Subscriptions',
    rules: 'Reply rules',
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
    case 'updates': return renderUpdates();
    case 'mailboxes': return renderMailboxes();
    case 'subscriptions': return renderSubscriptions();
    case 'rules': return renderRules();
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
        const id = await api.connect({ ...d, password: f.password });
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
  const toggle = (label: string, hint: string, checked: boolean, onchange: (v: boolean) => void) =>
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }),
      h('span', {}, label, h('div', { class: 'hint' }, hint)));

  const modes: [ReplyMode, string, string][] = [
    ['off', 'Suggest only', 'Draft replies show up in Inbox Pilot. Nothing goes to the mailbox until you press Send.'],
    ['draft', 'Save drafts', 'Put a reply draft in this mailbox for each email that needs one. Nothing is sent.'],
    ['send', 'Auto-send to trusted senders', 'Send replies on its own, but only to the senders below. Everyone else gets a draft.'],
  ];

  return h('div', { class: 'perms' },
    h('h4', {}, 'What Pilot may do here'),
    toggle('Read new mail and add it to my updates', 'This is the Start watching / Pause switch.', a.watching,
      (v) => void run(() => api.updateAccount(a.id, { watching: v }))),
    toggle('Alert me about important mail', 'A Windows notification for anything marked "needs you today".', p.notify, (v) => set({ notify: v })),
    toggle('Archive emails when I ask', 'Lets the Archive button move mail out of the inbox in this mailbox.', p.manage, (v) => set({ manage: v })),
    h('h4', {}, 'Replies'),
    modes.map(([value, label, hint]) =>
      h('label', { class: 'check' },
        h('input', { type: 'radio', name: `replies-${a.id}`, value, checked: p.replies === value, onchange: () => set({ replies: value }) }),
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
    toggle('Sort mail with Pilot labels', labelHint(a), p.labels, (v) => set({ labels: v })),
    h('div', { class: 'field' },
      h('label', {}, 'Archive automatically once summarized'),
      ([['newsletter', 'Newsletters'], ['promo', 'Promotions'], ['notification', 'Notifications, receipts and alerts']] as [Category, string][]).map(([c, label]) =>
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: p.autoClean.includes(c),
            disabled: !p.manage,
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
    h('button', { class: tab === 'done' ? 'active' : '', onclick: () => { tab = 'done'; render(); } }, `Done (${done.length})`)));

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
  if (collapsed) return h('details', { class: 'group' }, h('summary', {}, `${title} (${items.length})`), items.map(card));
  return h('section', { class: 'group' }, h('h2', {}, title), items.map(card));
}

function replyLine(r: ReplyRecord): HTMLElement {
  const who = r.auto ? 'Pilot' : 'You';
  const what = { drafted: 'saved a reply draft', sent: 'sent a reply', skipped: 'did not reply', failed: 'tried to reply but it failed' }[r.state];
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

function card(u: Update): HTMLElement {
  const m = u.message;
  const t = u.triage;
  const account = accountOf(u);
  const isOpen = u.status !== 'done';
  const canOpen = !!(m.webLink || account?.webmailUrl);

  const openEditor = () => {
    const sig = account?.permissions.signature.trim();
    editors.set(u.key, (t?.draftReply ?? '') + (sig ? `\n\n${sig}` : ''));
    render();
    document.getElementById(`reply-${u.key}`)?.focus();
  };

  const actions = isOpen
    ? [
        btn('Done', () => void run(() => api.act(u.key, 'done'))),
        account?.permissions.manage ? btn('Archive', () => void run(() => api.act(u.key, 'archive'), 'Archived')) : null,
        u.status === 'new'
          ? btn('Snooze till tomorrow', () => void run(() => api.act(u.key, 'snooze')))
          : btn('Unsnooze', () => void run(() => api.act(u.key, 'reopen'))),
        editors.has(u.key) ? null : btn(t?.draftReply ? 'Review reply' : 'Reply', openEditor),
        canOpen ? btn('Open in mail', () => void run(() => api.open(u.key)), 'ghost') : null,
        btn(showOriginal.has(u.key) ? 'Hide email' : 'Show email', () => {
          if (!showOriginal.delete(u.key)) showOriginal.add(u.key);
          render();
        }, 'ghost'),
        btn('Re-read', () => void run(() => api.redraft(u.key), 'Summary refreshed'), 'ghost'),
      ]
    : [
        btn('Move back to open', () => void run(() => api.act(u.key, 'reopen'))),
        canOpen ? btn('Open in mail', () => void run(() => api.open(u.key)), 'ghost') : null,
      ];

  return h('article', { class: `card p${t?.priority ?? 0} ${isOpen ? '' : 'done'}` },
    h('div', { class: 'card-head' },
      h('span', { class: 'from', title: m.from.email }, m.from.name || m.from.email || 'Unknown sender'),
      t ? h('span', { class: `chip c-${t.category}` }, CAT_LABEL[t.category]) : null,
      h('span', { class: 'meta' }, `${relTime(m.receivedAt)}${state.accounts.length > 1 && account ? ` · ${account.email}` : ''}`)),
    h('div', { class: 'subject' }, m.subject || '(no subject)'),
    h('p', { class: 'summary' }, t ? t.summary : u.triageError ? `Couldn't summarize this one: ${u.triageError}` : m.snippet),
    t?.actionItems.length ? h('ul', { class: 'todos' }, t.actionItems.map((a) => h('li', {}, a))) : null,
    u.reply ? replyLine(u.reply) : null,
    autoLine(u),
    showOriginal.has(u.key) ? h('pre', { class: 'original' }, m.body || m.snippet) : null,
    editors.has(u.key) ? replyEditor(u) : null,
    h('div', { class: 'actions' }, actions));
}

function replyEditor(u: Update): HTMLElement {
  const to = u.message.replyTo ?? u.message.from;
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
  return h('div', { class: 'editor' },
    h('div', { class: 'hint' }, `Reply to ${to.name ? `${to.name} <${to.email}>` : to.email}`),
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
  const [briefingEl, briefingOn] = check('Brief me every morning', s.briefing.enabled,
    'A Windows notification and a summary at the top of Updates: what needs you, deadlines and drafts waiting.');
  const briefingTime = h('input', { type: 'time', value: s.briefing.time });
  const ollamaUrl = text(s.ollama.url);
  const model = h('input', { type: 'text', value: s.ollama.model, list: 'models' });
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
      briefing: { enabled: briefingOn.checked, time: briefingTime.value || '08:00' },
      ollama: { url: ollamaUrl.value.trim(), model: model.value.trim() },
      google: { clientId: gId.value.trim(), clientSecret: gSecret.value.trim() },
      microsoft: { clientId: mId.value.trim(), tenant: mTenant.value.trim() || 'common' },
    };
    void run(() => api.saveSettings(patch), 'Settings saved');
  } },
    h('fieldset', {}, h('legend', {}, 'You'),
      field('Your name', name, 'This PC has one Pilot, and it works for you.'),
      field('Check for mail every (minutes)', poll),
      field('When a mailbox starts being watched, look back (hours)', lookback)),
    h('fieldset', {}, h('legend', {}, 'Morning briefing'),
      briefingEl,
      field('Time', briefingTime)),
    h('fieldset', {}, h('legend', {}, 'Local AI (Ollama)'),
      field('Ollama address', ollamaUrl),
      field('Model', h('div', { class: 'row' }, model, modelList, btn('Find installed', loadModels)),
        'Any chat model you have pulled, such as llama3.1:8b, qwen2.5:7b or gemma4:e4b. If this one is not installed, Pilot switches to one that is.')),
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

// ---- boot ----

api.onState(onState);
api.getState().then((s) => {
  state = s;
  if (s.settings.userName) onboardStep = 'mail';
  render();
});
