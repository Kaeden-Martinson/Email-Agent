import type { ServerConfig } from '../../shared/types.js';
import { api, btn, h, openPerms, render, run, toast, ui, valueOf } from '../core.js';
import { aiSetupPanel } from './aisetup.js';
import { banner, button, field } from '../ui.js';

// ---- onboarding ----

export function renderOnboarding(): HTMLElement {
  if (ui.onboardStep === 'name') {
    const name = h('input', { type: 'text', value: ui.state.settings.userName, placeholder: 'Your name', autofocus: true });
    return h('div', { class: 'onboard' },
      h('h1', {}, 'Welcome to Inbox Pilot'),
      h('p', { class: 'lede' },
        'Your Pilot lives on this PC and works for one person: you. It watches the mailboxes you connect, tells you what matters, and only replies the way you allow.'),
      h('form', { class: 'settings', onsubmit: (e: Event) => {
        e.preventDefault();
        const userName = name.value.trim();
        if (!userName) return toast('Enter your name to continue.');
        void run(async () => {
          ui.onboardStep = 'ai';
          await api.saveSettings({ userName });
          // The name box still has focus (Enter), which would hold back the redraw.
          (document.activeElement as HTMLElement | null)?.blur();
          render();
        });
      } },
        field('What should your Pilot call you?', name, 'It uses this when it writes replies for you.'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Continue')));
  }

  if (ui.onboardStep === 'ai') {
    return h('div', { class: 'onboard' },
      h('h1', {}, 'Set up the AI on this PC'),
      h('p', { class: 'lede' }, 'Pilot reads your email with an AI that runs on this computer, so your mail never goes to an AI company. This is a one-time setup.'),
      aiSetupPanel(() => { ui.onboardStep = 'mail'; render(); }),
      h('div', { class: 'actions' },
        btn('Back', () => { ui.onboardStep = 'name'; render(); }, 'ghost'),
        btn('Skip for now', () => { ui.onboardStep = 'mail'; render(); }, 'ghost')));
  }

  const finish = async (accountId?: string) => {
    ui.view = 'mailboxes';
    if (accountId) openPerms.add(accountId);
    await run(() => api.saveSettings({ onboarded: true }));
  };
  return h('div', { class: 'onboard' },
    h('h1', {}, `Hi ${ui.state.settings.userName}, let's add your first mailbox`),
    h('p', { class: 'lede' },
      "Type an email address. Pilot works out whether it's Gmail, Outlook or another provider and sets it up for you. You can add more mailboxes later."),
    renderAddMailbox((id) => {
      void finish(id);
      toast('Mailbox added. Choose what Pilot may do there, then press Start watching.');
    }),
    h('div', { class: 'actions' },
      btn('Back', () => { ui.onboardStep = 'ai'; render(); }, 'ghost'),
      btn('Skip for now', () => void finish(), 'ghost')));
}

// ---- add mailbox ----

function serverFields(label: string, server: ServerConfig): HTMLElement {
  return h('div', { class: 'g-field' },
    h('label', {}, label),
    h('div', { class: 'row' },
      h('input', { type: 'text', value: server.host, oninput: (e: Event) => { server.host = valueOf(e).trim(); } }),
      h('input', { type: 'number', class: 'port', value: String(server.port), oninput: (e: Event) => { server.port = Number(valueOf(e)); } }),
      h('label', { class: 'check inline' },
        h('input', { type: 'checkbox', checked: server.secure, onchange: (e: Event) => { server.secure = (e.target as HTMLInputElement).checked; } }),
        'SSL/TLS')),
    h('div', { class: 'hint' }, 'Unticked means STARTTLS.'));
}

export function renderAddMailbox(onAdded: (id: string) => void, onCancel?: () => void): HTMLElement {
  const f = (ui.addFlow ??= { email: '', busy: '', password: '' });
  const d = f.discovery;

  const connect = () => {
    if (!d) return;
    f.busy = d.kind === 'imap' ? 'Checking the password with the server…' : 'Waiting for you to sign in in your browser…';
    render();
    void run(async () => {
      try {
        const id = await api.connect({ ...d, password: f.password, access: f.access ?? 'full' });
        ui.addFlow = null;
        onAdded(id);
      } finally {
        if (ui.addFlow) {
          ui.addFlow.busy = '';
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
        h('button', { class: 'g-btn primary', type: 'submit', disabled: !!f.busy }, f.busy ? 'Looking…' : 'Continue'))),
      f.busy ? h('div', { class: 'hint' }, f.busy) : null,
      onCancel ? button('Cancel', { kind: 'ghost', onClick: onCancel }) : null);
  }

  const reset = () => {
    f.discovery = undefined;
    f.password = '';
    render();
  };
  const head = h('div', { class: 'found' },
    h('div', {}, h('strong', {}, d.email), ` · ${d.providerName}`),
    button('Use a different address', { kind: 'ghost', onClick: reset, disabled: !!f.busy }));

  const footer = [
    f.busy ? h('div', { class: 'hint busy' }, f.busy) : null,
    f.busy && d.kind !== 'imap'
      ? banner('info', [
          d.kind === 'gmail'
            ? 'If Google says "Access blocked", the person who shared Inbox Pilot needs to add your Gmail address to its test users first. Closed the browser tab? Cancel and sign in again.'
            : 'Blocked, or closed the browser tab? Cancel and sign in again.'],
          [button('Cancel sign-in', { onClick: () => void run(() => api.cancelSignIn()) })])
      : null,
    onCancel ? button('Cancel', { kind: 'ghost', disabled: !!f.busy, onClick: () => { ui.addFlow = null; onCancel(); } }) : null,
  ];

  if (d.kind !== 'imap') {
    const brand = d.kind === 'gmail' ? 'Google' : 'Microsoft';
    const available = ui.state.signIn[d.kind];
    return h('div', { class: 'add-mailbox' }, head,
      available
        ? h('p', { class: 'hint' }, `Your browser opens a ${brand} sign-in page. Inbox Pilot never sees your password.`)
        : banner('warn', [`${brand} sign-in isn't set up in this copy of Inbox Pilot yet. The developer needs to add a ${brand} client to oauth-clients.json (see the README).`]),
      h('div', { class: 'g-field' }, h('label', {}, 'What Pilot may do'),
        ([
          ['full', 'Full access (recommended)', 'Read mail, and, only when you allow it per mailbox, archive, label, save drafts or send.'],
          ['readonly', 'Read-only', 'Summaries, search, deadlines and reminders only. Pilot can never change this mailbox or send from it.'],
        ] as ['full' | 'readonly', string, string][]).map(([value, label, hint]) =>
          h('label', { class: 'check' },
            h('input', { type: 'radio', name: 'access', checked: (f.access ?? 'full') === value, onchange: () => { f.access = value; } }),
            h('span', {}, h('strong', {}, label), h('div', { class: 'hint' }, hint))))),
      h('div', { class: 'g-acts' }, button(`Sign in with ${brand}`, { kind: 'primary', onClick: connect, disabled: !available || !!f.busy })),
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
    d.appPasswordUrl ? button(`Create an app password at ${d.providerName}`, { kind: 'ghost', onClick: () => void run(() => api.openUrl(d.appPasswordUrl!)) }) : null,
    d.imap && d.smtp
      ? h('details', { class: 'servers' }, h('summary', {}, 'Server settings'), serverFields('Incoming (IMAP)', d.imap), serverFields('Outgoing (SMTP)', d.smtp))
      : null,
    h('div', { class: 'g-acts' }, h('button', { class: 'g-btn primary', type: 'submit', disabled: !!f.busy }, 'Connect')),
    footer);
}
