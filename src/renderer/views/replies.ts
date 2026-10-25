import type { Category, Settings } from '../../shared/types.js';
import { api, btn, CAT_LABEL, h, relTime, render, run, ui } from '../core.js';
import { check, field, text } from './settings.js';

let styleBusy = false;

/** "Learn my writing style": reads recent sent mail once and keeps only a short description. */
function styleBlock(): HTMLElement {
  const st = ui.state.settings.writingStyle;
  const learn = () => {
    styleBusy = true;
    render();
    void run(async () => {
      try {
        await api.learnStyle();
      } finally {
        styleBusy = false;
        render();
      }
    }, 'Writing style learned');
  };
  return h('div', { class: 'field' },
    h('label', {}, 'Your writing style'),
    st
      ? h('div', { class: 'rule-preview' },
          h('div', {}, st.description),
          h('div', { class: 'hint' },
            [st.greeting && `Opens with "${st.greeting}"`, st.signoff && `closes with "${st.signoff}"`, `${st.length} emails`].filter(Boolean).join(' · ') +
              ` · learned from ${st.samples} sent emails ${relTime(st.learnedAt)}`))
      : h('div', { class: 'hint' }, 'Pilot can read your recent sent emails once and describe how you write (greeting, sign-off, length, tone), so drafts sound like you. Only the short description is kept.'),
    h('div', { class: 'actions' },
      btn(styleBusy ? 'Reading your sent mail…' : st ? 'Learn again' : 'Learn my writing style', learn, st ? '' : 'primary', styleBusy),
      st ? btn('Forget it', () => void run(() => api.forgetStyle(), 'Writing style removed'), 'ghost') : null));
}

export function renderRules(): HTMLElement {
  const ar = ui.state.settings.autoReply;
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
      field('Tone', tone, 'For example: "Warm and casual" or "Formal, short, no exclamation marks".'),
      styleBlock()),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}
