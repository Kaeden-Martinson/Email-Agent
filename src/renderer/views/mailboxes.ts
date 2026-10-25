import type { Account, AccountPatch, AccountPermissions, Category, ReplyMode } from '../../shared/types.js';
import { api, btn, h, openPerms, relTime, render, run, toast, ui, valueOf } from '../core.js';
import { renderAddMailbox } from './onboarding.js';
import { field } from './settings.js';

// ---- mailboxes ----

export function renderMailboxes(): HTMLElement {
  const wrap = h('div');
  if (ui.addFlow) {
    wrap.append(h('div', { class: 'banner' }, h('h3', {}, 'Add a mailbox'),
      renderAddMailbox((id) => {
        openPerms.add(id);
        render();
        toast('Mailbox added. Choose what Pilot may do there, then press Start watching.');
      }, () => render())));
  } else {
    wrap.append(h('div', { class: 'actions top-actions' },
      btn('Add mailbox', () => { ui.addFlow = { email: '', busy: '', password: '' }; render(); }, 'primary')));
  }
  if (!ui.state.accounts.length && !ui.addFlow) {
    wrap.append(h('div', { class: 'empty' }, 'No mailboxes yet. Add Gmail, Outlook, Yahoo, iCloud or any other address.'));
  }
  for (const a of ui.state.accounts) wrap.append(mailboxCard(a));
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
