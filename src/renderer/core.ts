import { applyTheme } from './theme.js';
import type { Api, AppState, Category, Discovery, Update } from '../shared/types.js';

declare global {
  interface Window {
    api: Api;
  }
}

export type View = 'today' | 'ask' | 'updates' | 'deadlines' | 'followups' | 'mailboxes' | 'subscriptions' | 'activity' | 'sorting' | 'rules' | 'notifications' | 'settings';

/** The add-mailbox flow in progress. */
export type AddFlow = { email: string; busy: string; discovery?: Discovery; password: string; access?: 'full' | 'readonly' };

export const api = window.api;

/** Shared screen state that more than one module reads or reassigns (ES modules can't reassign an imported `let`). */
export const ui: {
  state: AppState;
  view: View;
  tab: 'open' | 'done';
  onboardStep: 'name' | 'ai' | 'mail';
  /** The add-mailbox flow in progress, if any. */
  addFlow: AddFlow | null;
  deferredRender: boolean;
  selectedKey: string | null;
  showKeys: boolean;
  snoozeFor: string | null;
  /** Which item's "Remind me…" box is open, as "u:<key>", "f:<id>" or "c:<id>". */
  remindFor: string | null;
  remindText: string;
  remindPreview: string;
} = {
  state: undefined as unknown as AppState,
  view: 'today',
  tab: 'open',
  onboardStep: 'name',
  addFlow: null,
  deferredRender: false,
  selectedKey: null,
  showKeys: false,
  snoozeFor: null,
  remindFor: null,
  remindText: '',
  remindPreview: '',
};

/** Reply text being edited, by update key. Survives re-renders. */
export const editors = new Map<string, string>();
export const showOriginal = new Set<string>();
/** Email bodies fetched on demand (state carries no bodies). */
export const bodies = new Map<string, string>();
/** Cards with the conversation panel open. */
export const showThread = new Set<string>();
/** Mailboxes whose permissions panel is expanded. */
export const openPerms = new Set<string>();

export const CAT_LABEL: Record<Category, string> = {
  action: 'Action',
  reply: 'Reply',
  fyi: 'FYI',
  newsletter: 'Newsletter',
  promo: 'Promo',
  notification: 'Notification',
  spam: 'Spam',
};

// ---- helpers ----

export type Child = Node | string | null | undefined | false;

/** Builds DOM with text nodes only, so nothing from an email is ever parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
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
export function toast(text: string, action?: { label: string; fn: () => void }): void {
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
export function quickAct(u: Update, action: 'done' | 'snooze' | 'archive'): void {
  void run(async () => {
    const id = await api.act(u.key, action);
    const what = action === 'archive' ? 'Archived' : action === 'done' ? 'Marked done' : 'Snoozed till tomorrow';
    toast(what, {
      label: 'Undo',
      fn: () => void run(() => (action === 'archive' && id ? api.undo(id) : api.act(u.key, 'reopen')), 'Undone'),
    });
  });
}

export async function run(fn: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await fn();
    if (done) toast(done);
    return true;
  } catch (e) {
    toast(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return false;
  }
}

export function relTime(ms: number): string {
  const mins = (Date.now() - ms) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const btn = (label: string, onclick: () => void, cls = '', disabled = false) =>
  h('button', { class: `btn ${cls}`, type: 'button', onclick, disabled }, label);

export const valueOf = (e: Event) => (e.target as HTMLInputElement).value;

export const accountOf = (u: Update) => ui.state.accounts.find((a) => a.id === u.message.accountId);

export const go = (v: View) => {
  ui.view = v;
  render();
};

// ---- rendering ----

const views = new Map<View, () => HTMLElement>();
let chrome: { nav: () => HTMLElement; header: () => HTMLElement; notice: () => HTMLElement | null; onboarding: () => HTMLElement };

export function registerView(v: View, fn: () => HTMLElement): void { views.set(v, fn); }
export function registerChrome(c: typeof chrome): void { chrome = c; }

export function render(): void {
  const root = document.getElementById('app')!;
  if (!ui.state.settings.onboarded) {
    root.replaceChildren(chrome.onboarding());
    return;
  }
  const view = views.get(ui.view)!;
  root.replaceChildren(h('div', { class: 'g-shell' }, chrome.nav(), h('main', { class: 'g-main' }, chrome.header(), chrome.notice(), view())));
}

/** On a state push, re-render unless the user is typing; the form views keep their own values. */
export function onState(next: AppState): void {
  applyTheme(next.settings.appearance);
  ui.state = next;
  const active = document.activeElement;
  const typing =
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type !== 'checkbox' && active.type !== 'radio') ||
    active instanceof HTMLSelectElement;
  if (ui.state.settings.onboarded && (ui.view === 'rules' || ui.view === 'settings')) {
    document.querySelector('.g-side')?.replaceWith(chrome.nav());
    document.querySelector('.g-head')?.replaceWith(chrome.header());
  } else if (typing) {
    ui.deferredRender = true;
  } else {
    render();
  }
}

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (ui.deferredRender && !(active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement)) {
      ui.deferredRender = false;
      render();
    }
  });
});

export function openReply(u: Update): void {
  const sig = accountOf(u)?.permissions.signature.trim();
  if (!editors.has(u.key)) editors.set(u.key, (u.triage?.draftReply ?? '') + (sig ? `\n\n${sig}` : ''));
  render();
  document.getElementById(`reply-${u.key}`)?.focus();
}

// ---- keyboard ----

export const SHORTCUTS: [string, string][] = [
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

export function visibleCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('article.card[data-key]')].filter((el) => el.offsetParent !== null);
}

export function select(key: string | null): void {
  ui.selectedKey = key;
  for (const el of document.querySelectorAll('article.card.selected')) el.classList.remove('selected');
  const el = key ? document.querySelector<HTMLElement>(`article.card[data-key="${CSS.escape(key)}"]`) : null;
  el?.classList.add('selected');
  el?.scrollIntoView({ block: 'nearest' });
}

export function keysOverlay(): HTMLElement {
  return h('div', { class: 'keys-overlay', onclick: () => { ui.showKeys = false; document.querySelector('.keys-overlay')?.remove(); } },
    h('div', { class: 'keys-box' },
      h('h3', {}, 'Keyboard shortcuts'),
      h('table', {}, SHORTCUTS.map(([k, what]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, what)))),
      h('div', { class: 'hint' }, 'Press Esc or click anywhere to close.')));
}

let pendingG = 0;

document.addEventListener('keydown', (e) => {
  if (!ui.state?.settings.onboarded) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    go('ask');
    return;
  }
  const el = document.activeElement;
  const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;
  if (e.key === 'Escape') {
    if (ui.showKeys) {
      ui.showKeys = false;
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
    ui.showKeys = !ui.showKeys;
    document.querySelector('.keys-overlay')?.remove();
    if (ui.showKeys) document.body.append(keysOverlay());
    return;
  }

  const cards = visibleCards();
  const at = cards.findIndex((c) => c.dataset.key === ui.selectedKey);
  if (e.key === 'j' || e.key === 'k') {
    if (!cards.length) return;
    const next = at < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, at + (e.key === 'j' ? 1 : -1)));
    select(cards[next].dataset.key ?? null);
    e.preventDefault();
    return;
  }
  const u = at >= 0 ? ui.state.updates.find((x) => x.key === ui.selectedKey) : undefined;
  if (!u) return;
  const after = cards[at + 1]?.dataset.key ?? cards[at - 1]?.dataset.key ?? null;
  const moveOn = () => { ui.selectedKey = after; };
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
