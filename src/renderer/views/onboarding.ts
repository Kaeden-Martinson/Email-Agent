import type { ServerConfig } from '../../shared/types.js';
import { api, h, openPerms, render, run, toast, ui, valueOf, type Child } from '../core.js';
import { icon, type IconName } from '../icons.js';
import { aiSetupPanel } from './aisetup.js';
import { banner, button, field } from '../ui.js';

// ---- onboarding ----

type Step = 'name' | 'ai' | 'mail';
const STEPS: { id: Step; label: string; sub: string; icon: IconName }[] = [
  { id: 'name', label: 'Your name', sub: 'Used when Lodestar writes replies for you', icon: 'user' },
  { id: 'ai', label: 'AI on this PC', sub: 'Runs locally, one-time setup', icon: 'cpu' },
  { id: 'mail', label: 'Your mailbox', sub: 'Gmail, Outlook or any provider', icon: 'mail' },
];

function welcome(step: Step, content: Child[]): HTMLElement {
  const at = STEPS.findIndex((x) => x.id === step);
  return h('div', { class: 'g-welcome' },
    h('div', { class: 'l' },
      h('div', { class: 'g-brand big' }, h('span', { class: 'mark' }, icon('lodestar', 14)), 'Lodestar'),
      h('h1', {}, 'Your email, read on your own PC.'),
      h('p', {}, 'Lodestar sorts what matters, tracks bills and deadlines, and drafts replies you approve. Nothing is sent to an AI company.'),
      h('ul', {},
        h('li', {}, icon('shield', 15), 'Encrypted on this PC'),
        h('li', {}, icon('check', 15), 'Never sends without your OK'),
        h('li', {}, icon('undo', 15), 'Archive can be undone'))),
    h('div', { class: 'r' },
      h('div', { class: 'g-step-k' }, `Step ${at + 1} of 3`),
      ...STEPS.map((x, i) => h('div', { class: `g-check ${i < at ? 'done' : i === at ? 'on' : 'todo'}` },
        icon(i < at ? 'check' : x.icon, 15), h('div', {}, h('b', {}, x.label), h('span', {}, x.sub)))),
      h('div', { class: 'g-wbody' }, ...content)));
}

export function renderOnboarding(): HTMLElement {
  if (ui.onboardStep === 'name') {
    const name = h('input', { type: 'text', value: ui.state.settings.userName, placeholder: 'Your name', autofocus: true });
    return welcome('name', [
      h('form', { onsubmit: (e: Event) => {
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
        field('What should Lodestar call you?', name, 'It uses this when it writes replies for you.'),
        h('div', { class: 'g-acts' }, h('button', { class: 'g-btn primary', type: 'submit' }, 'Continue')))]);
  }

  if (ui.onboardStep === 'ai') {
    return welcome('ai', [
      h('p', { class: 'g-hint' }, 'Lodestar reads your email with an AI that runs on this computer, so your mail never goes to an AI company. This is a one-time setup.'),
      aiSetupPanel(() => { ui.onboardStep = 'mail'; render(); }),
      h('div', { class: 'g-acts' },
        button('Back', { kind: 'ghost', onClick: () => { ui.onboardStep = 'name'; render(); } }),
        button('Skip for now', { kind: 'ghost', onClick: () => { ui.onboardStep = 'mail'; render(); } }))]);
  }

  const finish = async (accountId?: string) => {
    ui.view = 'mailboxes';
    if (accountId) openPerms.add(accountId);
    await run(() => api.saveSettings({ onboarded: true }));
  };
  return welcome('mail', [
    h('p', { class: 'g-hint' },
      `Hi ${ui.state.settings.userName}. Type an email address. Lodestar works out whether it's Gmail, Outlook or another provider and sets it up for you. You can add more mailboxes later.`),
    renderAddMailbox((id) => {
      void finish(id);
      toast('Mailbox added. Choose what Lodestar may do there, then press Start watching.');
    }),
    h('div', { class: 'g-acts' },
      button('Back', { kind: 'ghost', onClick: () => { ui.onboardStep = 'ai'; render(); } }),
      button('Skip for now', { kind: 'ghost', onClick: () => void finish() }))]);
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
            ? 'If Google says "Access blocked", the person who shared Lodestar needs to add your Gmail address to its test users first. Closed the browser tab? Cancel and sign in again.'
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
        ? h('p', { class: 'hint' }, `Your browser opens a ${brand} sign-in page. Lodestar never sees your password.`)
        : banner('warn', [`${brand} sign-in isn't set up in this copy of Lodestar yet. The developer needs to add a ${brand} client to oauth-clients.json (see the README).`]),
      h('div', { class: 'g-field' }, h('label', {}, 'What Lodestar may do'),
        ([
          ['full', 'Full access (recommended)', 'Read mail, and, only when you allow it per mailbox, archive, label, save drafts or send.'],
          ['readonly', 'Read-only', 'Summaries, search, deadlines and reminders only. Lodestar can never change this mailbox or send from it.'],
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
