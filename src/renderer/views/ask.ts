import type { AskResult, SearchHit } from '../../shared/types.js';
import { api, btn, h, relTime, run, ui, valueOf } from '../core.js';

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

export function renderAskAnswer(): HTMLElement | null {
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

export function renderAskResultsList(): HTMLElement {
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

export function renderAskResults(): void {
  const box = document.getElementById('ask-results');
  if (!box) return;
  box.replaceChildren(...[renderAskAnswer(), renderAskResultsList()].filter((x): x is HTMLElement => !!x));
}

export function renderAsk(): HTMLElement {
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
      `Matching emails appear as you type. Ask gets an answer from your local AI, using only your email and citing it. Nothing leaves this PC.${ui.state.search.semantic ? '' : ' Semantic search is off (see Settings).'}`),
    h('div', { id: 'ask-results' }));
  setTimeout(() => { renderAskResults(); input.focus(); });
  return wrap;
}
