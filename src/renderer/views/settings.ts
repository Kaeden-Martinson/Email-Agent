import type { Settings, TriageSource } from '../../shared/types.js';
import type { Appearance } from '../../shared/theme.js';
import { api, btn, h, relTime, render, run, toast, ui, valueOf, type Child } from '../core.js';
import { field, segmented, table } from '../ui.js';
import { aiSetupPanel } from './aisetup.js';
import { SOURCE_LABEL } from './updates.js';

// ---- forms ----

export function check(label: string, checked: boolean, hint?: string): [HTMLElement, HTMLInputElement] {
  const input = h('input', { type: 'checkbox', checked });
  return [h('label', { class: 'check' }, input, h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null)), input];
}

export const text = (value: string, type = 'text') => h('input', { type, value });

type SettingsSection = 'general' | 'ai' | 'briefing' | 'automation' | 'privacy' | 'updates';
let settingsSection: SettingsSection = 'general';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI model' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'automation', label: 'Automation' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'updates', label: 'Updates' },
];

/** A checkbox that saves the briefing as soon as it changes (always reads the latest briefing settings). */
function briefingCheck(label: string, checked: boolean, patch: (b: Settings['briefing'], v: boolean) => Settings['briefing']): HTMLElement {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; void run(() => api.saveSettings({ briefing: patch(ui.state.settings.briefing, v) })); } }),
    h('span', {}, label));
}

export function renderSettings(): HTMLElement {
  const s = ui.state.settings;
  const save = (patch: Partial<Settings>) => void run(() => api.saveSettings(patch), 'Settings saved');
  const form = (onSave: () => void, ...children: Child[]) =>
    h('form', { onsubmit: (e: Event) => { e.preventDefault(); onSave(); } },
      ...children, h('div', { class: 'g-acts' }, h('button', { class: 'g-btn primary', type: 'submit' }, 'Save')));

  const sections: Record<SettingsSection, () => HTMLElement> = {
    general: () => {
      const name = text(s.userName);
      const poll = text(String(s.pollMinutes), 'number');
      const lookback = text(String(s.lookbackHours), 'number');
      const followUpDays = text(String(s.followUpDays), 'number');
      const [loginEl, login] = check('Start Lodestar when I sign in to Windows', s.launchAtLogin,
        ui.state.app.packaged ? 'It starts quietly in the tray.' : 'Available in the installed app (not when running from source).');
      if (!ui.state.app.packaged) login.disabled = true;
      const gId = text(s.google.clientId);
      const gSecret = text(s.google.clientSecret, 'password');
      const mId = text(s.microsoft.clientId);
      const mTenant = text(s.microsoft.tenant);
      const appearanceOptions: { value: Appearance; label: string }[] = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match Windows' }];
      // The state push does not re-render this view (so typing survives); update the selected segment here.
      const seg: HTMLElement = segmented<Appearance>(appearanceOptions, s.appearance, (v) => {
        seg.querySelectorAll('button').forEach((b, i) => {
          const on = appearanceOptions[i].value === v;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        });
        void run(() => api.saveSettings({ appearance: v }));
      });
      const appearance = h('div', { class: 'g-setrow' },
        h('div', {}, h('b', {}, 'Appearance'), h('span', {}, 'Applies to the whole app straight away.')), seg);
      return form(() => save({
        userName: name.value.trim(),
        pollMinutes: Math.max(1, Number(poll.value) || 5),
        lookbackHours: Math.max(1, Number(lookback.value) || 48),
        followUpDays: Math.min(30, Math.max(1, Number(followUpDays.value) || 3)),
        launchAtLogin: login.checked,
        google: { clientId: gId.value.trim(), clientSecret: gSecret.value.trim() },
        microsoft: { clientId: mId.value.trim(), tenant: mTenant.value.trim() || 'common' },
      }),
        appearance,
        field('Your name', name, 'Lodestar on this PC works for one person: you.'),
        field('Check for mail every (minutes)', poll),
        field('When a mailbox starts being watched, look back (hours)', lookback),
        field('Suggest a follow-up after (working days without a reply)', followUpDays),
        loginEl,
        h('details', { class: 'g-more' }, h('summary', {}, 'Advanced: use your own sign-in clients'),
          h('p', { class: 'hint' },
            'Lodestar normally uses the Google and Microsoft sign-in clients built into the app. Fill these in only to use your own.'),
          h('fieldset', {}, h('legend', {}, 'Google'),
            field('OAuth client ID', gId),
            field('OAuth client secret', gSecret)),
          h('fieldset', {}, h('legend', {}, 'Microsoft'),
            field('Application (client) ID', mId),
            field('Tenant', mTenant, '"common" works for personal and work accounts.'))));
    },

    ai: () => {
      const ollamaUrl = text(s.ollama.url);
      const model = h('input', { type: 'text', value: s.ollama.model, list: 'models' });
      const fastModel = h('input', { type: 'text', value: s.ollama.fastModel, list: 'models', placeholder: 'Same as above' });
      const modelList = h('datalist', { id: 'models' });
      const loadModels = () =>
        void run(async () => {
          const models = await api.listModels();
          modelList.replaceChildren(...models.map((m) => h('option', { value: m })));
          toast(models.length ? `Ollama has ${models.length} model${models.length === 1 ? '' : 's'} installed` : 'Ollama is running but has no models. Run: ollama pull llama3.1:8b');
        });
      return form(() => save({
        ollama: { url: ollamaUrl.value.trim(), model: model.value.trim(), fastModel: fastModel.value.trim(), embedModel: s.ollama.embedModel },
      }),
        aiSetupPanel(),
        field('Ollama address', ollamaUrl),
        field('Model', h('div', { class: 'row' }, model, modelList, btn('Find installed', loadModels)),
          'Any chat model you have pulled, such as llama3.1:8b, qwen2.5:7b or gemma4:e4b. If this one is not installed, Lodestar switches to one that is.'),
        field('Quick-read model (optional)', fastModel, 'A smaller model for automated mail. Leave blank to use the main model.'),
        semanticField(),
        statsTable());
    },

    briefing: () => {
      const b = s.briefing;
      return h('div', {},
        briefingCheck('Send a daily briefing', b.enabled, (cur, v) => ({ ...cur, enabled: v })),
        h('div', { class: 'row' },
          field('Time', h('input', { type: 'time', value: b.time, onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...ui.state.settings.briefing, time: valueOf(e) || '08:00' } })) })),
          field('Days', h('select', { onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...ui.state.settings.briefing, days: (e.target as HTMLSelectElement).value as 'everyday' | 'weekdays' } })) },
            h('option', { value: 'everyday', selected: b.days === 'everyday' }, 'Every day'),
            h('option', { value: 'weekdays', selected: b.days === 'weekdays' }, 'Weekdays only')))),
        h('div', { class: 'g-field' }, h('label', {}, 'Include'),
          (Object.entries({ urgent: 'What needs you', deadlines: 'Bills and deadlines', followups: 'Follow-ups', approvals: 'Approvals waiting' }) as [keyof typeof b.sections, string][]).map(([k, label]) =>
            briefingCheck(label, b.sections[k], (cur, v) => ({ ...cur, sections: { ...cur.sections, [k]: v } })))),
        h('div', { class: 'hint' }, 'These save as you change them. Which devices get the briefing is set per channel in Notifications.'));
    },

    automation: () => {
      const [previewEl, preview] = check('Preview mode: automatic actions wait for my approval', s.previewMode,
        'Labels, auto-archive, auto-replies and auto-unsubscribes are proposed in Activity instead of done. Recommended until you trust them. Replies you send yourself are never affected.');
      return form(() => save({ previewMode: preview.checked }), previewEl);
    },

    privacy: () => {
      const [encryptEl, encrypt] = check("Encrypt Lodestar's data on this PC", s.encryptAtRest,
        'Your summaries, email text and settings are stored encrypted with Windows (DPAPI), like your sign-ins. Only your Windows account can read them.');
      return form(() => save({ encryptAtRest: encrypt.checked }),
        encryptEl,
        h('div', { class: 'hint' }, `Lodestar ${ui.state.app.version}${ui.state.app.packaged ? '' : ' (running from source)'}${ui.state.app.devMode ? ' · developer mode: Ctrl+Shift+I opens DevTools' : ''}`),
        h('div', { class: 'row' },
          btn('Open data folder', () => void run(() => api.openFolder('data'))),
          btn('Open logs folder', () => void run(() => api.openFolder('logs')))),
        h('div', { class: 'hint' }, 'Logs never contain email text, addresses or passwords. A backup of your data is kept for each of the last 7 days.'));
    },

    updates: () => {
      const [updCheckEl, updCheck] = check('Check for new versions', s.updates.check, 'Lodestar only tells you about an update; installing it is up to you.');
      const feed = text(s.updates.feedUrl);
      return form(() => save({ updates: { check: updCheck.checked, feedUrl: feed.value.trim() } }),
        updCheckEl,
        field('Update feed', feed, 'An https address with the latest version (a GitHub "latest release" link works). Set once releases are published.'),
        h('div', { class: 'row' },
          btn('Check now', () => void run(() => api.checkForUpdates(), 'Checked for updates')),
          h('span', { class: 'hint' },
            ui.state.app.update
              ? ui.state.app.update.error
                ? `Last check failed: ${ui.state.app.update.error}`
                : ui.state.app.update.available
                  ? `Version ${ui.state.app.update.latest} is available.`
                  : `You're up to date (checked ${relTime(ui.state.app.update.checkedAt)}).`
              : '')));
    },
  };

  return h('div', { class: 'g-settings' },
    h('nav', { class: 'g-subnav' }, SECTIONS.map((x) =>
      h('button', { type: 'button', class: x.id === settingsSection ? 'on' : '', onclick: () => { settingsSection = x.id; render(); } }, x.label))),
    h('div', { class: 'g-setbody' }, sections[settingsSection]()));
}

const EMBED_MODEL = 'nomic-embed-text';

/** Semantic search needs a small local embedding model; downloading it is the user's explicit choice. */
function semanticField(): HTMLElement {
  const st = ui.state.search;
  return h('div', { class: 'g-field' },
    h('label', {}, 'Semantic search for Ask'),
    st.semantic
      ? h('div', { class: 'hint' }, `On, using ${st.model}. ${st.indexed} of ${st.total} emails indexed on this PC.`)
      : h('div', {},
          h('div', { class: 'hint' }, 'Off. Ask uses keyword search, which works well for names and specific words. Semantic search also finds emails that mean the same thing in different words. It needs a small local embedding model.'),
          btn(`Download ${EMBED_MODEL} (about 270 MB) and turn on`, () => {
            if (!confirm(`Download the ${EMBED_MODEL} model (about 270 MB) through Ollama? It runs locally; your email is not sent anywhere.`)) return;
            toast('Downloading… this can take a few minutes.');
            void run(() => api.enableSemantic(EMBED_MODEL), 'Semantic search is on. Indexing your email in the background.');
          })));
}

/** Pipeline metrics: how mail was classified, how fast, and how often you corrected it. */
function statsTable(): HTMLElement {
  const st = ui.state.stats;
  const rows = (['rule', 'fast', 'light', 'full'] as TriageSource[]).map((src) => {
    const b = st.bySource[src];
    const accuracy = b.count ? `${Math.round(100 * (1 - b.corrected / b.count))}%` : '–';
    return { cells: [
      SOURCE_LABEL[src],
      String(b.count),
      b.count && (src === 'light' || src === 'full') ? `${(b.avgMs / 1000).toFixed(1)}s` : src === 'rule' || src === 'fast' ? 'instant' : '–',
      accuracy,
    ] };
  });
  return h('div', { class: 'g-field' },
    h('label', {}, 'How your mail was read'),
    table([{ label: 'Stage' }, { label: 'Emails', align: 'right' }, { label: 'Avg time', align: 'right' }, { label: 'Not corrected', align: 'right' }], rows),
    h('div', { class: 'hint' }, `${st.corrections} correction${st.corrections === 1 ? '' : 's'} so far. "Not corrected" is the share you didn't have to fix.`));
}
