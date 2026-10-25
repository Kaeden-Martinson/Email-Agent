import type { AiSetupStatus } from '../../shared/types.js';
import { api, h, registerLivePart, run, ui } from '../core.js';
import { banner, button, card, progress } from '../ui.js';

// ---- AI setup ----

export let aiStatus: AiSetupStatus | null = null;
let aiBusy = false;
let aiPoll: number | undefined;

/** The panel's container id: it redraws itself in place, so a form around it (Settings) keeps what was typed. */
const PANEL_ID = 'ai-setup-panel';
let panelOnReady: (() => void) | undefined;

/** Redraws just the panel, if it is on screen; returns whether it was. */
function redrawPanel(): boolean {
  const el = document.getElementById(PANEL_ID);
  if (!el) return false;
  el.replaceWith(aiSetupPanel(panelOnReady));
  return true;
}

// Download progress arrives with state pushes, which don't redraw Settings (or wait while someone types).
registerLivePart(() => { if (ui.state.aiProgress || aiBusy) redrawPanel(); });

function refreshAi(): void {
  void api.aiStatus().then((s) => { aiStatus = s; redrawPanel(); }).catch(() => {});
}

function stopPoll(): void {
  clearInterval(aiPoll);
  aiPoll = undefined;
}

/** Install Ollama, start it, download a model that fits: each a button, with progress. */
export function aiSetupPanel(onReady?: () => void): HTMLElement {
  panelOnReady = onReady;
  return h('div', { id: PANEL_ID }, panelBody(onReady));
}

function panelBody(onReady?: () => void): HTMLElement {
  if (!aiStatus) {
    refreshAi();
    return banner('info', ['Checking this PC…']);
  }
  const s = aiStatus;
  const step = (fn: () => Promise<void>, done: string) => {
    aiBusy = true;
    redrawPanel();
    void run(async () => {
      try {
        await fn();
      } finally {
        aiBusy = false;
        aiStatus = await api.aiStatus().catch(() => aiStatus);
        redrawPanel();
      }
    }, done);
  };
  const p = ui.state.aiProgress;
  const progressBlock = p
    ? h('div', { class: 'g-aiprog' },
        h('div', {}, h('strong', {}, p.step), p.percent !== undefined ? ` ${p.percent}%` : '…'),
        progress(p.percent))
    : null;
  const pc = `This PC: ${s.ramGB} GB memory${s.vramGB ? `, ${s.vramGB} GB graphics memory` : ''}.`;

  if (s.ready) {
    stopPoll();
    return banner('ok', [h('strong', {}, 'The AI is ready. '), `Lodestar will use ${s.usable}. ${pc}`],
      onReady ? [button('Continue', { kind: 'primary', onClick: onReady })] : []);
  }
  if (s.ollama === 'missing') {
    // Someone may install Ollama by hand meanwhile: keep checking.
    // Each tick checks the panel is still on screen, and stops when it isn't.
    aiPoll ??= window.setInterval(() => { if (document.getElementById(PANEL_ID)) refreshAi(); else stopPoll(); }, 5000);
    return card([
      h('div', { class: 'g-step-k' }, 'Step 1 of 2'),
      h('div', {}, h('strong', {}, 'Install Ollama. '), 'Ollama is the free program that runs the AI on this PC (about 1.7 GB download, no admin rights needed). Lodestar downloads it from ollama.com and checks it is genuinely signed by Ollama before installing.'),
      progressBlock,
      h('div', { class: 'g-acts' },
        button(aiBusy ? 'Installing…' : 'Install Ollama for me', { kind: 'primary', icon: 'download', disabled: aiBusy, onClick: () => step(() => api.aiInstallOllama(), 'Ollama installed') }),
        button('Get it myself', { kind: 'ghost', onClick: () => void run(() => api.openUrl('https://ollama.com/download/windows')) }))]);
  }
  if (s.ollama === 'stopped') {
    return card([
      h('strong', {}, 'Ollama is installed but not running. '),
      h('div', { class: 'g-acts' }, button(aiBusy ? 'Starting…' : 'Start Ollama', { kind: 'primary', disabled: aiBusy, onClick: () => step(() => api.aiStartOllama(), 'Ollama started') }))]);
  }
  return card([
    h('div', { class: 'g-step-k' }, 'Step 2 of 2'),
    h('div', {}, h('strong', {}, 'Download the AI model. '),
      `Lodestar picked ${s.recommended.model} (${s.recommended.sizeGB} GB) for this PC. ${pc}`),
    s.recommended.note ? h('div', { class: 'g-hint' }, s.recommended.note) : null,
    progressBlock,
    h('div', { class: 'g-acts' },
      button(aiBusy ? 'Downloading…' : `Download ${s.recommended.sizeGB} GB model`, { kind: 'primary', icon: 'download', disabled: aiBusy, onClick: () => step(() => api.aiPullModel(), 'AI model ready') }))]);
}
