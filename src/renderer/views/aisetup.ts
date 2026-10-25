import type { AiSetupStatus } from '../../shared/types.js';
import { api, btn, h, render, run, ui } from '../core.js';

// ---- AI setup ----

export let aiStatus: AiSetupStatus | null = null;
let aiBusy = false;
let aiPoll: number | undefined;

function refreshAi(): void {
  void api.aiStatus().then((s) => { aiStatus = s; render(); }).catch(() => {});
}

/** Install Ollama, start it, download a model that fits: each a button, with progress. */
export function aiSetupPanel(onReady?: () => void): HTMLElement {
  if (!aiStatus) {
    refreshAi();
    return h('div', { class: 'banner' }, 'Checking this PC…');
  }
  const s = aiStatus;
  const step = (fn: () => Promise<void>, done: string) => {
    aiBusy = true;
    render();
    void run(async () => {
      try {
        await fn();
      } finally {
        aiBusy = false;
        aiStatus = await api.aiStatus().catch(() => aiStatus);
        render();
      }
    }, done);
  };
  const p = ui.state.aiProgress;
  const progress = p
    ? h('div', { class: 'rule-preview' },
        h('div', {}, h('strong', {}, p.step), p.percent !== undefined ? ` ${p.percent}%` : '…'),
        p.percent !== undefined ? h('progress', { max: 100, value: p.percent }) : null)
    : null;
  const pc = `This PC: ${s.ramGB} GB memory${s.vramGB ? `, ${s.vramGB} GB graphics memory` : ''}.`;

  if (s.ready) {
    clearInterval(aiPoll);
    aiPoll = undefined;
    return h('div', { class: 'banner' },
      h('strong', {}, 'The AI is ready. '), `Pilot will use ${s.usable}. ${pc}`,
      onReady ? h('div', { class: 'actions' }, btn('Continue', onReady, 'primary')) : null);
  }
  if (s.ollama === 'missing') {
    // Someone may install Ollama by hand meanwhile: keep checking.
    aiPoll ??= window.setInterval(refreshAi, 5000);
    return h('div', { class: 'banner' },
      h('div', {}, h('strong', {}, 'Step 1 of 2: install Ollama. '), 'Ollama is the free program that runs the AI on this PC (about 1.7 GB download, no admin rights needed). Pilot downloads it from ollama.com and checks it is genuinely signed by Ollama before installing.'),
      progress,
      h('div', { class: 'actions' },
        btn(aiBusy ? 'Installing…' : 'Install Ollama for me', () => step(() => api.aiInstallOllama(), 'Ollama installed'), 'primary', aiBusy),
        btn('Get it myself', () => void run(() => api.openUrl('https://ollama.com/download/windows')), 'ghost')));
  }
  if (s.ollama === 'stopped') {
    return h('div', { class: 'banner' },
      h('strong', {}, 'Ollama is installed but not running. '),
      h('div', { class: 'actions' }, btn(aiBusy ? 'Starting…' : 'Start Ollama', () => step(() => api.aiStartOllama(), 'Ollama started'), 'primary', aiBusy)));
  }
  return h('div', { class: 'banner' },
    h('div', {}, h('strong', {}, 'Step 2 of 2: download the AI model. '),
      `Pilot picked ${s.recommended.model} (${s.recommended.sizeGB} GB) for this PC. ${pc}`),
    s.recommended.note ? h('div', { class: 'hint' }, s.recommended.note) : null,
    progress,
    h('div', { class: 'actions' },
      btn(aiBusy ? 'Downloading…' : `Download ${s.recommended.sizeGB} GB model`, () => step(() => api.aiPullModel(), 'AI model ready'), 'primary', aiBusy)));
}
