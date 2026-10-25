// The window's title bar, drawn by Lodestar itself (the window has no native frame): logo, title,
// and minimize / maximize-restore / close buttons. Dragging the bar moves the window; double-click maximizes.
import { api, h } from './core.js';
import { icon } from './icons.js';

let maximized = false;
let listening = false;

function maxButton(): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: 'g-winbtn',
    id: 'win-max',
    title: maximized ? 'Restore' : 'Maximize',
    'aria-label': maximized ? 'Restore' : 'Maximize',
    onclick: () => void api.windowToggleMaximize(),
  }, icon(maximized ? 'winRestore' : 'winMaximize', 14));
}

/** Builds the title bar once; it lives outside #app, so screen redraws never touch it. */
export function initTitlebar(demo: boolean): void {
  const bar = document.getElementById('titlebar');
  if (!bar) return;
  bar.replaceChildren(
    h('div', { class: 'g-titlebar-brand' },
      h('span', { class: 'mark' }, icon('lodestar', 11)),
      h('b', {}, 'Lodestar'),
      demo ? h('span', {}, 'Demo mode') : null),
    h('div', { class: 'g-winbtns' },
      h('button', { type: 'button', class: 'g-winbtn', title: 'Minimize', 'aria-label': 'Minimize', onclick: () => void api.windowMinimize() }, icon('winMinimize', 14)),
      maxButton(),
      h('button', { type: 'button', class: 'g-winbtn close', title: 'Close (Lodestar keeps running in the tray)', 'aria-label': 'Close', onclick: () => void api.windowClose() }, icon('winClose', 14))),
  );
  if (listening) return;
  listening = true;
  const update = (m: boolean) => {
    maximized = m;
    document.getElementById('win-max')?.replaceWith(maxButton());
  };
  void api.windowIsMaximized().then(update);
  api.onWindowMaximized(update);
}
