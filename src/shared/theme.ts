// Light/dark theme choice, shared by the main process (window color) and the renderer (CSS).
export type Appearance = 'light' | 'dark' | 'system';

export const THEME_BG = { light: '#fbfbfc', dark: '#0e0f12' } as const;

/** The theme to show: the explicit choice, or Windows' setting for "system" and anything unrecognized. */
export function resolveTheme(a: Appearance | undefined, systemDark: boolean): 'light' | 'dark' {
  if (a === 'light' || a === 'dark') return a;
  return systemDark ? 'dark' : 'light';
}
