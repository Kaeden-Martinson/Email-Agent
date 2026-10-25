import type { Priority, Rule, RulePreview, SuggestedRule } from '../../shared/types.js';
import { api, btn, CAT_LABEL, h, relTime, render, run, ui } from '../core.js';

// ---- sorting rules ----

const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Always important', 2: 'Normal', 3: 'Always low priority' };

function ruleEffectLabel(e: Rule['effect']): string {
  if (e.hide) return 'Hide (move to Done)';
  return e.priority ? PRIORITY_LABEL[e.priority] : e.category ? `Always ${CAT_LABEL[e.category]}` : 'No change';
}

export function renderSorting(): HTMLElement {
  const wrap = h('div');
  wrap.append(h('p', { class: 'hint' },
    'Rules always win over the AI. Teach Pilot from any email ("Always from this sender…"), or add a rule here. A single "More/Less important" click only changes that one email; after two similar corrections, or when you keep archiving or replying to a sender, Pilot suggests a rule.'));

  if (ui.state.suggestedRules.length) {
    wrap.append(h('h3', { class: 'section' }, 'Suggested'));
    for (const s of ui.state.suggestedRules) wrap.append(suggestedRow(s));
  }

  wrap.append(plainRuleBox());

  wrap.append(h('h3', { class: 'section' }, `Your rules (${ui.state.rules.length})`));
  if (!ui.state.rules.length) wrap.append(h('div', { class: 'empty' }, 'No rules yet.'));
  for (const r of ui.state.rules) wrap.append(ruleRow(r));

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
