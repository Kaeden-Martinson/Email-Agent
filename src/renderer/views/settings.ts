import type { Settings, TriageSource } from '../../shared/types.js';
import { api, btn, h, relTime, run, toast, ui } from '../core.js';
import { SOURCE_LABEL } from './updates.js';

// ---- forms ----

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function check(label: string, checked: boolean, hint?: string): [HTMLElement, HTMLInputElement] {
  const input = h('input', { type: 'checkbox', checked });
  return [h('label', { class: 'check' }, input, h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null)), input];
}

export const text = (value: string, type = 'text') => h('input', { type, value });

export function renderSettings(): HTMLElement {
  const s = ui.state.settings;
  const name = text(s.userName);
  const poll = text(String(s.pollMinutes), 'number');
  const lookback = text(String(s.lookbackHours), 'number');
  const followUpDays = text(String(s.followUpDays), 'number');
  const ollamaUrl = text(s.ollama.url);
  const model = h('input', { type: 'text', value: s.ollama.model, list: 'models' });
  const fastModel = h('input', { type: 'text', value: s.ollama.fastModel, list: 'models', placeholder: 'Same as above' });
  const [encryptEl, encrypt] = check("Encrypt Pilot's data on this PC", s.encryptAtRest,
    'Your summaries, email text and settings are stored encrypted with Windows (DPAPI), like your sign-ins. Only your Windows account can read them.');
  const [loginEl, login] = check('Start Pilot when I sign in to Windows', s.launchAtLogin,
    ui.state.app.packaged ? 'It starts quietly in the tray.' : 'Available in the installed app (not when running from source).');
  if (!ui.state.app.packaged) login.disabled = true;
  const [updCheckEl, updCheck] = check('Check for new versions', s.updates.check, 'Pilot only tells you about an update; installing it is up to you.');
  const feed = text(s.updates.feedUrl);
  const [previewEl, preview] = check('Preview mode: automatic actions wait for my approval', s.previewMode,
    'Labels, auto-archive, auto-replies and auto-unsubscribes are proposed in Activity instead of done. Recommended until you trust them. Replies you send yourself are never affected.');
  const modelList = h('datalist', { id: 'models' });
  const gId = text(s.google.clientId);
  const gSecret = text(s.google.clientSecret, 'password');
  const mId = text(s.microsoft.clientId);
  const mTenant = text(s.microsoft.tenant);

  const loadModels = () =>
    void run(async () => {
      const models = await api.listModels();
      modelList.replaceChildren(...models.map((m) => h('option', { value: m })));
      toast(models.length ? `Ollama has ${models.length} model${models.length === 1 ? '' : 's'} installed` : 'Ollama is running but has no models. Run: ollama pull llama3.1:8b');
    });

  return h('form', { class: 'settings', onsubmit: (e: Event) => {
    e.preventDefault();
    const patch: Partial<Settings> = {
      userName: name.value.trim(),
      pollMinutes: Math.max(1, Number(poll.value) || 5),
      lookbackHours: Math.max(1, Number(lookback.value) || 48),
      followUpDays: Math.min(30, Math.max(1, Number(followUpDays.value) || 3)),
      ollama: { url: ollamaUrl.value.trim(), model: model.value.trim(), fastModel: fastModel.value.trim(), embedModel: s.ollama.embedModel },
      previewMode: preview.checked,
      encryptAtRest: encrypt.checked,
      launchAtLogin: login.checked,
      updates: { check: updCheck.checked, feedUrl: feed.value.trim() },
      google: { clientId: gId.value.trim(), clientSecret: gSecret.value.trim() },
      microsoft: { clientId: mId.value.trim(), tenant: mTenant.value.trim() || 'common' },
    };
    void run(() => api.saveSettings(patch), 'Settings saved');
  } },
    h('fieldset', {}, h('legend', {}, 'You'),
      field('Your name', name, 'This PC has one Pilot, and it works for you.'),
      field('Check for mail every (minutes)', poll),
      field('When a mailbox starts being watched, look back (hours)', lookback),
      field('Suggest a follow-up after (working days without a reply)', followUpDays)),
    h('fieldset', {}, h('legend', {}, 'Automation'), previewEl),
    h('fieldset', {}, h('legend', {}, 'Privacy and startup'), encryptEl, loginEl),
    h('fieldset', {}, h('legend', {}, 'Updates'),
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
            : ''))),
    h('fieldset', {}, h('legend', {}, 'Troubleshooting'),
      h('div', { class: 'hint' }, `Inbox Pilot ${ui.state.app.version}${ui.state.app.packaged ? '' : ' (running from source)'}${ui.state.app.devMode ? ' · developer mode: Ctrl+Shift+I opens DevTools' : ''}`),
      h('div', { class: 'row' },
        btn('Open logs folder', () => void run(() => api.openFolder('logs'))),
        btn('Open data folder', () => void run(() => api.openFolder('data')))),
      h('div', { class: 'hint' }, 'Logs never contain email text, addresses or passwords. A backup of your data is kept for each of the last 7 days.')),
    h('fieldset', {}, h('legend', {}, 'Local AI (Ollama)'),
      field('Ollama address', ollamaUrl),
      field('Model', h('div', { class: 'row' }, model, modelList, btn('Find installed', loadModels)),
        'Any chat model you have pulled, such as llama3.1:8b, qwen2.5:7b or gemma4:e4b. If this one is not installed, Pilot switches to one that is.'),
      field('Quick-read model (optional)', fastModel, 'A smaller model for automated mail. Leave blank to use the main model.'),
      semanticField(),
      statsTable()),
    h('details', { class: 'advanced' }, h('summary', {}, 'Advanced: use your own sign-in clients'),
      h('p', { class: 'hint' },
        'Inbox Pilot normally uses the Google and Microsoft sign-in clients built into the app. Fill these in only to use your own.'),
      h('fieldset', {}, h('legend', {}, 'Google'),
        field('OAuth client ID', gId),
        field('OAuth client secret', gSecret)),
      h('fieldset', {}, h('legend', {}, 'Microsoft'),
        field('Application (client) ID', mId),
        field('Tenant', mTenant, '"common" works for personal and work accounts.'))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}

const EMBED_MODEL = 'nomic-embed-text';

/** Semantic search needs a small local embedding model; downloading it is the user's explicit choice. */
function semanticField(): HTMLElement {
  const st = ui.state.search;
  return h('div', { class: 'field' },
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
    return h('tr', {},
      h('td', {}, SOURCE_LABEL[src]),
      h('td', {}, String(b.count)),
      h('td', {}, b.count && (src === 'light' || src === 'full') ? `${(b.avgMs / 1000).toFixed(1)}s` : src === 'rule' || src === 'fast' ? 'instant' : '–'),
      h('td', {}, accuracy));
  });
  return h('div', { class: 'field' },
    h('label', {}, 'How your mail was read'),
    h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Stage'), h('th', {}, 'Emails'), h('th', {}, 'Avg time'), h('th', {}, 'Not corrected'))),
      h('tbody', {}, rows)),
    h('div', { class: 'hint' }, `${st.corrections} correction${st.corrections === 1 ? '' : 's'} so far. "Not corrected" is the share you didn't have to fix.`));
}
