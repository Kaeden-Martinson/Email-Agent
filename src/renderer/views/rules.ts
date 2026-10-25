import type { Priority, Rule, RulePreview, SuggestedRule } from '../../shared/types.js';
import { api, CAT_LABEL, h, relTime, render, run, ui } from '../core.js';
import type { Child } from '../core.js';
import { button, card, chip, emptyState, table, tabs, toggle } from '../ui.js';

// ---- sorting rules ----

const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Always important', 2: 'Normal', 3: 'Always low priority' };

function ruleEffectLabel(e: Rule['effect']): string {
  if (e.hide) return 'Hide (move to Done)';
  return e.priority ? PRIORITY_LABEL[e.priority] : e.category ? `Always ${CAT_LABEL[e.category]}` : 'No change';
}

type RulesTab = 'rules' | 'suggested';
let rulesTab: RulesTab = 'rules';
let showNewRule = false;

export function renderSorting(): HTMLElement {
  const wrap = h('div', { class: 'g-rules' });
  const suggested = ui.state.suggestedRules;
  wrap.append(tabs<RulesTab>(
    [{ id: 'rules', label: 'Rules', count: ui.state.rules.length }, { id: 'suggested', label: 'Suggested', count: suggested.length }],
    rulesTab,
    (id) => { rulesTab = id; render(); },
    button('New rule', { kind: 'primary', icon: 'plus', onClick: () => { showNewRule = !showNewRule; render(); } })));

  if (showNewRule) wrap.append(newRuleCard());

  if (rulesTab === 'suggested') {
    if (!suggested.length) wrap.append(emptyState('No suggestions right now. After a couple of similar corrections, or when you keep archiving or replying to a sender, Lodestar suggests a rule.'));
    else wrap.append(card(suggested.map(suggestedRow), { pad: false }));
  } else if (!ui.state.rules.length) {
    wrap.append(emptyState('No rules yet. Rules always win over the AI. Describe one, or teach Lodestar from any email ("Always from this sender…").',
      button('New rule', { kind: 'primary', icon: 'plus', onClick: () => { showNewRule = true; render(); } })));
  } else {
    wrap.append(table(
      [{ label: 'When' }, { label: 'Then' }, { label: 'Source' }, { label: 'Used', align: 'right' }, { label: 'On', align: 'right' }, { label: '' }],
      ui.state.rules.map((r) => ({ cells: ruleCells(r) }))));
  }
  return wrap;
}

function newRuleCard(): HTMLElement {
  const who = h('input', { type: 'text', placeholder: 'person@company.com or @company.com' });
  const effect = h('select', {},
    h('option', { value: '1' }, 'Always important'),
    h('option', { value: '3' }, 'Always low priority'),
    h('option', { value: 'hide' }, 'Hide (move to Done)'));
  const byAddress: HTMLFormElement = h('form', { onsubmit: (e: Event) => {
    e.preventDefault();
    const v = who.value.trim().toLowerCase();
    if (!v) return;
    const match = v.startsWith('@') ? { domain: v.slice(1) } : { sender: v };
    void run(() => api.saveRule({ enabled: true, match, effect: effectFrom(effect.value), origin: 'manual' }), 'Rule added');
  } },
    h('div', { class: 'g-field' }, h('label', {}, 'Address'), who),
    h('div', { class: 'g-field' }, h('label', {}, 'Then'), effect),
    button('Add', { kind: 'primary', onClick: () => byAddress.requestSubmit() }));
  const disclosure = h('details', { class: 'g-more' }, h('summary', {}, 'Or add by address'), byAddress);
  return card([plainRuleBox(), disclosure]);
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
  const form: HTMLFormElement = h('form', { onsubmit: (e: Event) => { e.preventDefault(); preview(); } },
    h('div', { class: 'g-field' },
      h('label', {}, 'Describe a rule'),
      h('div', { class: 'g-inline' }, input, button(ruleBusy ? 'Reading…' : 'Preview', { kind: 'primary', disabled: ruleBusy, onClick: () => form.requestSubmit() })),
      h('div', { class: 'hint' }, 'Rules only sort your mail (important, low priority or hidden). They never send, delete or unsubscribe.')),
    p
      ? h('div', { class: 'rule-preview' },
          h('div', {}, h('strong', {}, p.description)),
          h('div', { class: 'hint' },
            p.count ? `Would apply to ${p.count} email${p.count === 1 ? '' : 's'} you have now${p.count > 5 ? ', including' : ''}:` : "Doesn't match any email you have now; it will apply to new ones."),
          p.examples.length ? h('ul', {}, p.examples.map((x) => h('li', {}, `${x.from}: ${x.subject || '(no subject)'}`))) : null,
          h('div', { class: 'g-acts' },
            button('Create rule', { kind: 'primary', onClick: () => void run(async () => {
              await api.saveRule({ enabled: true, match: p.match, effect: p.effect, origin: 'manual' });
              ruleText = '';
              rulePreview = null;
              showNewRule = false;
              render();
            }, 'Rule created') }),
            button('Cancel', { kind: 'ghost', onClick: () => { rulePreview = null; render(); } })))
      : null);
  return form;
}

function suggestedRow(s: SuggestedRule): HTMLElement {
  return h('div', { class: 'g-sugg' },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, s.match.sender ?? `@${s.match.domain}`), s.match.subjectContains ? ` · subject contains "${s.match.subjectContains}"` : '', ` → ${ruleEffectLabel(s.effect)}`),
      h('div', { class: 'muted' }, s.because)),
    button('Create rule', { kind: 'primary', tiny: true, onClick: () => void run(() => api.saveRule({ enabled: true, match: s.match, effect: s.effect, origin: 'suggestion' }), 'Rule created') }),
    button('Not now', { kind: 'ghost', tiny: true, onClick: () => void run(() => api.dismissSuggestion(s)) }));
}

function effectChip(e: Rule['effect']): HTMLElement {
  if (e.hide) return chip('Hide');
  if (e.priority === 1) return chip('Important', 'danger');
  if (e.priority === 3) return chip('Low priority');
  return chip(ruleEffectLabel(e));
}

function ruleCells(r: Rule): Child[] {
  const effect = h('select', {
    class: 'g-sel',
    'aria-label': 'Change what this rule does',
    onchange: (e: Event) => void run(() => api.saveRule({ ...r, effect: effectFrom((e.target as HTMLSelectElement).value) })),
  },
    h('option', { value: '1', selected: r.effect.priority === 1 && !r.effect.hide }, 'Always important'),
    h('option', { value: '3', selected: r.effect.priority === 3 && !r.effect.hide }, 'Always low priority'),
    h('option', { value: 'hide', selected: !!r.effect.hide }, 'Hide (move to Done)'));
  const who = r.match.sender ?? (r.match.domain ? `@${r.match.domain}` : 'anyone');
  const source = r.origin === 'manual' ? 'Added by you' : r.origin === 'suggestion' ? 'From a suggestion' : 'From a correction';
  return [
    h('div', { class: r.enabled ? '' : 'muted' },
      h('strong', {}, who),
      r.match.subjectContains ? h('div', { class: 'muted' }, `subject contains "${r.match.subjectContains}"`) : null),
    effectChip(r.effect),
    h('span', { class: 'muted' }, source),
    h('span', { title: r.lastHitAt ? `Last used ${relTime(r.lastHitAt)}` : 'Not used yet' }, String(r.hits)),
    toggle(r.enabled, (v) => void run(() => api.saveRule({ ...r, enabled: v })), `Rule on for ${who}`),
    h('span', { class: 'g-inline' }, effect, button('Delete', { kind: 'ghost', tiny: true, onClick: () => void run(() => api.deleteRule(r.id), 'Rule deleted') })),
  ];
}
