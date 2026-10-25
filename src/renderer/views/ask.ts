import type { AskResult, SearchHit } from '../../shared/types.js';
import { api, go, h, relTime, run, ui, valueOf } from '../core.js';
import { icon } from '../icons.js';
import { banner, emptyState, listRow, sectionTitle, skeleton } from '../ui.js';

// ---- ask my inbox: a conversation with sources ----

interface Turn { q: string; a?: AskResult; error?: string }

/** Session-only: the conversation lives until the app closes. */
const thread: Turn[] = [];
let askText = '';
let askHits: SearchHit[] = [];
let askTerms: string[] = [];
let askSemantic = false;
let askBusy = false;
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
      refresh();
      return;
    }
    const r = await api.search(askText);
    // The user may have submitted or cleared the box while the search ran.
    if (!askText.trim()) return;
    askHits = r.hits;
    askTerms = r.terms;
    askSemantic = r.semantic;
    refresh();
  }, 150);
}

function setInput(value: string): void {
  askText = value;
  const i = document.querySelector<HTMLInputElement>('.g-askbar input');
  if (i) i.value = value;
}

function submitAsk(): void {
  const q = askText.trim();
  if (!q || askBusy) return;
  const turn: Turn = { q };
  thread.push(turn);
  askBusy = true;
  clearTimeout(askTimer);
  askHits = [];
  setInput('');
  refresh(true);
  void run(async () => {
    try {
      turn.a = await api.ask(q);
    } catch (e) {
      turn.error = e instanceof Error ? e.message : String(e);
    } finally {
      askBusy = false;
      refresh(true);
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

function openEmail(key: string): void {
  const u = ui.state.updates.find((x) => x.key === key);
  if (!u) { void run(() => api.open(key)); return; }
  ui.tab = u.status === 'done' ? 'done' : 'open';
  ui.selectedKey = key;
  go('updates');
}

/** Source numbers run across the whole thread: each turn's citations start after the previous turn's. */
function numbering(): Map<Turn, Map<number, number>> {
  const out = new Map<Turn, Map<number, number>>();
  let next = 1;
  for (const t of thread) {
    const m = new Map<number, number>();
    for (const c of t.a?.citations ?? []) m.set(c.n, next++);
    out.set(t, m);
  }
  return out;
}

/** The answer text with [n] markers turned into clickable citation buttons. */
function answerBody(t: Turn, nums: Map<number, number>): HTMLElement {
  const a = t.a!;
  const p = h('div', {});
  const cite = (n: number): HTMLElement | string => {
    const c = a.citations.find((x) => x.n === n);
    const label = String(nums.get(n) ?? n);
    if (!c) return label;
    return h('button', { class: 'g-cite', type: 'button', title: c.title, onclick: () => { if (c.key) openEmail(c.key); } }, label);
  };
  let last = 0;
  for (const m of a.answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    p.append(a.answer.slice(last, m.index));
    for (const n of m[1].split(',').map(Number)) p.append(cite(n));
    last = m.index! + m[0].length;
  }
  p.append(a.answer.slice(last));
  const note = a.verified
    ? `Based on ${a.citations.length} source${a.citations.length === 1 ? '' : 's'}`
    : a.found ? 'No sources cited: double-check' : 'Not in your email';
  p.append(h('div', { class: 'hint', style: 'margin-top:6px' }, `${note} · ${(a.ms / 1000).toFixed(1)}s · on this PC${a.semantic ? ' · semantic search' : ''}`));
  return p;
}

function renderThread(): HTMLElement[] {
  const nums = numbering();
  const out: HTMLElement[] = [];
  for (const t of thread) {
    out.push(h('div', { class: 'g-msg me' }, t.q));
    if (t.error) out.push(h('div', { class: 'g-msg ai' }, banner('danger', [`Couldn't get an answer: ${t.error}`])));
    else if (!t.a) out.push(h('div', { class: 'g-msg ai', 'aria-busy': 'true' }, skeleton(2)));
    else out.push(h('div', { class: 'g-msg ai' }, answerBody(t, nums.get(t)!)));
  }
  return out;
}

/** Instant matches while typing, as rows with highlighted terms. */
function renderInstant(): HTMLElement | null {
  if (!askText.trim() || askBusy) return null;
  if (!askHits.length) return h('div', { class: 'hint' }, 'No matching emails yet. Press Enter to ask your local AI.');
  return h('div', {},
    sectionTitle(`Matching emails${askSemantic ? ' · keyword + semantic' : ''}`, askHits.length),
    h('div', { class: 'g-list' }, askHits.map((r) => listRow({
      dot: null,
      title: r.subject || '(no subject)',
      sub: [...highlight(r.snippet, askTerms)],
      right: `${r.from} · ${relTime(r.at)}`,
      onClick: () => openEmail(r.key),
    }))));
}

function renderSources(): HTMLElement {
  const nums = numbering();
  const rows: HTMLElement[] = [];
  for (const t of thread) {
    for (const c of t.a?.citations ?? []) {
      rows.push(h('div', { class: 'g-src', onclick: () => { if (c.key) openEmail(c.key); } },
        h('span', { class: 'g-cnum' }, String(nums.get(t)!.get(c.n))),
        h('div', { style: 'min-width:0' },
          h('div', { style: 'font-weight:600;font-size:12.5px' }, c.title),
          h('div', { class: 'hint' }, `${c.kind === 'email' ? c.from : c.kind === 'item' ? 'tracked date' : 'your commitment'} · ${new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`),
          h('div', { class: 'hint' }, ...highlight(c.excerpt.slice(0, 140), askTerms)))));
    }
  }
  return h('div', {}, sectionTitle('Sources', rows.length),
    rows.length ? rows : h('div', { class: 'hint' }, 'Cited emails appear here.'));
}

function renderBody(): HTMLElement[] {
  if (!thread.length && !askText.trim()) {
    return [emptyState('Ask anything about your email. Answers come from your local AI, use only your email, and cite it.'),
      h('div', { class: 'g-acts', style: 'flex-wrap:wrap;justify-content:center' }, ASK_EXAMPLES.map((ex) =>
        h('button', { class: 'g-btn', type: 'button', onclick: () => { setInput(ex); submitAsk(); } }, ex)))];
  }
  return [...renderThread(), renderInstant()].filter((x): x is HTMLElement => !!x);
}

function refresh(scroll = false): void {
  const t = document.getElementById('ask-thread');
  const s = document.getElementById('ask-srcs');
  if (!t || !s) return;
  t.replaceChildren(...renderBody());
  s.replaceChildren(renderSources());
  if (scroll) document.querySelector('.g-askbar')?.scrollIntoView({ block: 'end' });
}

export function renderAsk(): HTMLElement {
  const input = h('input', {
    type: 'search',
    value: askText,
    placeholder: 'Ask anything about your email, or search: from:dana lease last month',
    autofocus: true,
    oninput: (e: Event) => { askText = valueOf(e); runSearch(); refresh(); },
  });
  const bar = h('form', { class: 'g-askbar', onsubmit: (e: Event) => { e.preventDefault(); submitAsk(); } },
    icon('search'), input, h('span', { class: 'g-kbd' }, 'Enter'));
  const wrap = h('div', { class: 'g-chat' },
    h('div', { style: 'display:flex;flex-direction:column;min-width:0' },
      h('div', { class: 'g-thread', id: 'ask-thread' }, ...renderBody()),
      bar,
      h('div', { class: 'hint', style: 'margin-top:6px' },
        ui.state.search.semantic ? 'Semantic search is on: matches by meaning as well as keywords. Nothing leaves this PC.' : 'Semantic search is off (see Settings). Nothing leaves this PC.')),
    h('div', { class: 'g-srcs', id: 'ask-srcs' }, renderSources()));
  setTimeout(() => input.focus());
  return wrap;
}
