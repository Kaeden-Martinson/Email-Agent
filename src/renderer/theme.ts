import { resolveTheme, type Appearance } from '../shared/theme.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** Sets html[data-theme] from the setting ("system" follows Windows). */
export function applyTheme(a: Appearance): void {
  document.documentElement.dataset.theme = resolveTheme(a, media.matches);
}

/** Applies now and keeps following Windows while the setting is "system". */
export function initTheme(get: () => Appearance): void {
  applyTheme(get());
  media.addEventListener('change', () => applyTheme(get()));
}

/** The sidebar button flips to the opposite of what's showing. */
export function nextTheme(a: Appearance): 'light' | 'dark' {
  return resolveTheme(a, media.matches) === 'dark' ? 'light' : 'dark';
}
