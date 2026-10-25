import type { Account, AccountPatch, AccountPermissions, Category, ReplyMode } from '../../shared/types.js';
import { api, h, relTime, render, run, toast, ui, valueOf } from '../core.js';
import { banner, button, card, chip, emptyState, field, segmented, toggle } from '../ui.js';
import { renderAddMailbox } from './onboarding.js';

// ---- mailboxes ----

function startAddFlow(): void {
  ui.addFlow = { email: '', busy: '', password: '' };
  render();
}

export function renderMailboxes(): HTMLElement {
  const wrap = h('div', { class: 'g-mailboxes' });
  if (ui.addFlow) {
    wrap.append(card([
      h('div', { class: 'mbx-title' }, 'Add a mailbox'),
      renderAddMailbox(() => {
        render();
        toast('Mailbox added. Choose what Pilot may do there, then press Start watching.');
      }, () => render()),
    ]));
  } else {
    wrap.append(h('div', { class: 'g-acts mbx-top' }, h('span', { class: 'g-spacer' }),
      button('Add mailbox', { kind: 'primary', icon: 'plus', onClick: startAddFlow })));
  }
  for (const a of ui.state.accounts) wrap.append(mailboxCard(a));
  if (!ui.state.accounts.length && !ui.addFlow) {
    wrap.append(emptyState('No mailboxes yet. Add Gmail, Outlook, Yahoo, iCloud or any other address.'));
  } else if (!ui.addFlow) {
    const row = emptyState('Add a mailbox');
    row.classList.add('mbx-add');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.onclick = startAddFlow;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startAddFlow(); } };
    wrap.append(row);
  }
  return wrap;
}

function mailboxCard(a: Account): HTMLElement {
  const update = (patch: AccountPatch, done?: string) => void run(() => api.updateAccount(a.id, patch), done);
  const set = (perm: Partial<AccountPermissions>) => void run(() => api.updateAccount(a.id, { permissions: perm }));
  const ro = a.access === 'readonly';
  const connect = (access: 'full' | 'readonly', calendar: boolean | undefined, done: string) =>
    void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access, calendar }), done);

  const checked = a.lastSyncAt ? `checked ${relTime(a.lastSyncAt)}` : a.watching ? 'starting…' : 'not checked yet';
  const meta = `${a.providerName} · ${ro ? 'read-only' : 'full access'}${a.calendar ? ' · calendar connected' : ''} · ${checked}`;
  const head = h('div', { class: 'mbx-head' },
    h('span', { class: 'mbx-av', 'aria-hidden': 'true' }, (a.email[0] ?? '?').toUpperCase()),
    h('div', { class: 'mbx-who' }, h('b', {}, a.email), h('div', { class: 'mbx-meta' }, meta)),
    chip(a.watching ? 'Watching' : 'Paused', a.watching ? 'ok' : 'neutral'),
    a.watching
      ? button('Pause', { onClick: () => update({ watching: false }, `Paused ${a.email}`) })
      : button('Start watching', { kind: 'primary', onClick: () => update({ watching: true }, `Pilot is now watching ${a.email}`) }));

  const banners: HTMLElement[] = [];
  if (a.lastError) banners.push(banner('danger', [a.lastError]));
  if (a.needsReconnect && a.kind !== 'imap') {
    banners.push(banner('warn', [h('strong', {}, 'Needs to reconnect. '), 'Pilot lost access to this mailbox.'],
      [button('Reconnect', { kind: 'primary', onClick: () => connect(a.access ?? 'full', a.calendar, 'Reconnected. Checking mail…') })]));
  }
  if (ro) {
    banners.push(banner('info',
      [h('strong', {}, 'Connected read-only. '), "Pilot can read and summarize this mailbox but can't change it or send from it, so archiving, labels, drafts and replies are off."],
      a.kind !== 'imap' ? [button('Reconnect with full access', { onClick: () => connect('full', a.calendar, 'Reconnected with full access') })] : []));
  }
  if (a.kind !== 'imap') {
    banners.push(banner('info',
      [h('strong', {}, a.calendar ? 'Calendar connected. ' : 'Calendar: not connected. '),
        a.calendar
          ? 'When an email asks to find a time, reply suggestions offer your free times. Pilot sees only when you are busy, never event details, and never books anything.'
          : 'Let reply suggestions offer your free times. Pilot asks only for free/busy access: when you are busy, never event titles or details.'],
      [a.calendar
        ? button('Disconnect calendar', { kind: 'ghost', onClick: () => connect(a.access ?? 'full', false, 'Calendar disconnected') })
        : button('Connect calendar', { onClick: () => connect(a.access ?? 'full', true, 'Calendar connected') })]));
  }

  const remove = button('Remove mailbox', { kind: 'ghost', onClick: () => {
    if (confirm(`Disconnect ${a.email}? Its updates are removed from Inbox Pilot. Nothing is deleted from the mailbox.`)) {
      void run(() => api.removeAccount(a.id));
    }
  } });
  remove.classList.add('danger');

  return card([
    head,
    banners.length ? h('div', { class: 'mbx-banners' }, ...banners) : null,
    permissionRows(a, set, ro),
    h('div', { class: 'mbx-foot' },
      h('span', { class: 'hint' }, 'Changes save as you make them. Which kinds of email get replies, the tone and the daily send limit are under Replies.'),
      remove),
  ].filter((x): x is HTMLElement => x !== null), { pad: false });
}

/** A setting row: name and hint on the left, the control on the right. */
function permRow(label: string, hint: string, control: HTMLElement, extra?: HTMLElement): HTMLElement {
  return h('div', { class: 'mbx-row' },
    h('div', { class: 'mbx-txt' }, h('b', {}, label), h('span', {}, hint)),
    control,
    extra ? h('div', { class: 'mbx-extra' }, extra) : null);
}

function lockable(t: HTMLButtonElement, locked: boolean): HTMLButtonElement {
  if (locked) t.disabled = true;
  return t;
}

function permissionRows(a: Account, set: (perm: Partial<AccountPermissions>) => void, ro: boolean): HTMLElement {
  const p = a.permissions;
  const modes: [ReplyMode, string, string][] = [
    ['off', 'Suggest only', 'Draft replies show up in Inbox Pilot. Nothing goes to the mailbox until you press Send.'],
    ['draft', 'Save drafts', 'Put a reply draft in this mailbox for each email that needs one. Nothing is sent.'],
    ['send', 'Auto-send to trusted', 'Send replies on its own, but only to the senders below. Everyone else gets a draft.'],
  ];
  const unsub: ['off' | 'suggest' | 'auto', string, string][] = [
    ['off', 'Off', 'Pilot does not look for subscriptions to cancel.'],
    ['suggest', 'Suggest', 'Senders to unsubscribe from appear under Subscriptions with an Unsubscribe button.'],
    ['auto', 'Automatic', `After ${3} newsletters or promotions from the same sender in 30 days, using the sender's one-click unsubscribe. Pilot never visits unsubscribe web pages on its own.`],
  ];
  const cats: [Category, string][] = [['newsletter', 'Newsletters'], ['promo', 'Promotions'], ['notification', 'Notifications, receipts and alerts']];
  const cleanLocked = !p.manage || ro;

  const repliesSeg = segmented(modes.map(([value, label]) => ({ value, label })), p.replies, (v) => {
    if (ro && v !== 'off') return;
    set({ replies: v });
  });
  if (ro) repliesSeg.querySelectorAll('button').forEach((b, i) => { if (modes[i][0] !== 'off') b.disabled = true; });
  const unsubSeg = segmented(unsub.map(([value, label]) => ({ value, label })), p.unsubscribe, (v) => set({ unsubscribe: v }));

  const cleanBoxes = h('div', { class: 'mbx-cats' },
    cats.map(([c, label]) =>
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: p.autoClean.includes(c),
          disabled: cleanLocked,
          onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            set({ autoClean: on ? [...p.autoClean, c] : p.autoClean.filter((x) => x !== c) });
          },
        }),
        h('span', {}, label))),
    h('div', { class: 'hint' },
      p.manage
        ? "They stay in your mailbox's archive and on the Done tab here. Anything urgent or waiting on a reply is never archived."
        : 'Turn on "Archive when I ask" above to use this.'));

  return h('div', { class: 'mbx-perms' },
    permRow('Read new mail', 'Add new email to your updates. This is the Start watching / Pause switch.',
      toggle(a.watching, (v) => void run(() => api.updateAccount(a.id, { watching: v })), 'Read new mail')),
    permRow('Alert me about important mail', 'A Windows notification for anything marked "needs you today".',
      toggle(p.notify, (v) => set({ notify: v }), 'Alert me about important mail')),
    permRow('Archive when I ask', 'Lets the Archive button move mail out of the inbox in this mailbox.',
      lockable(toggle(p.manage, (v) => set({ manage: v }), 'Archive when I ask'), ro)),
    permRow('Label with categories', labelHint(a),
      lockable(toggle(p.labels, (v) => set({ labels: v }), 'Label with categories'), ro)),
    permRow('Clean up automatically', 'Archive these kinds of email once summarized.',
      lockable(toggle(p.autoClean.length > 0, (v) => set({ autoClean: v ? cats.map(([c]) => c) : [] }), 'Clean up automatically'), cleanLocked),
      cleanBoxes),
    permRow('Unsubscribe mode', (unsub.find(([v]) => v === p.unsubscribe) ?? unsub[0])[2], unsubSeg),
    permRow('Replies', (modes.find(([v]) => v === p.replies) ?? modes[0])[2], repliesSeg),
    h('div', { class: 'mbx-fields' },
      field('Trusted senders',
        h('textarea', {
          rows: 3,
          value: p.trustedSenders.join('\n'),
          placeholder: 'boss@company.com\n@company.com',
          onchange: (e: Event) => set({ trustedSenders: valueOf(e).split(/[\n,]/).map((s) => s.trim()).filter(Boolean) }),
        }),
        'One per line: a full address, or @domain for everyone at that company. Only used for auto-send.'),
      field('Signature for this mailbox',
        h('textarea', { rows: 3, value: p.signature, onchange: (e: Event) => set({ signature: valueOf(e) }) }))));
}

function labelHint(a: Account): string {
  if (a.kind === 'gmail') return 'Adds labels such as Pilot/Action and Pilot/Newsletters in Gmail.';
  if (a.kind === 'outlook') return 'Adds Outlook categories such as "Pilot: Action".';
  return 'Adds keywords such as Pilot_Action. Thunderbird and Apple Mail show them; some servers ignore them.';
}
