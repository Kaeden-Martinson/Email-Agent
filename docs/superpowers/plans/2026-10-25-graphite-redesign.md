# Graphite Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Inbox Pilot's renderer in the Graphite look with a light/dark toggle, SVG icons only and the layouts chosen per screen, without changing any app behavior.

**Architecture:** Design tokens in CSS custom properties switch on `html[data-theme]`. The 2,363-line `src/renderer/renderer.ts` is split into a core module (state, `h()`, render loop, helpers), shared UI builders, an icon module and one module per screen; the entry file registers screens with the core. Each screen is then rebuilt to its chosen layout using the shared builders. Main process only gains theme handling.

**Tech Stack:** Electron 45, TypeScript (tsc, ES modules in the renderer, CommonJS-style nodenext in main), plain DOM via `h()`, node:test, Inter font from `@fontsource/inter`.

**Spec:** `docs/superpowers/specs/2026-10-25-graphite-redesign-design.md` (mockups: `docs/superpowers/specs/mockups/graphite-screens.html`)

## Global Constraints

- No emoji anywhere in `src/renderer`; every icon is an inline SVG from `src/renderer/icons.ts`.
- One accent color: `#2b59d9` light, `#5b84f2` dark. Hairline 1px borders; no box-shadow except the shortcuts overlay.
- Radius: 5px controls, 6px panels, 8px window-level frames.
- Font: Inter 400/500/600 bundled locally; fallback `"Segoe UI", system-ui, sans-serif`. Type scale px: 10.5, 11.5, 12.5, 13.5, 16, 18.
- No framework, no bundler. Renderer imports use `.js` extensions (`import { x } from './core.js'`).
- CSP in `index.html` stays `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:` (fonts load under `default-src 'self'`).
- No change to IPC names, engine behavior, permissions or safety checks. All 220 existing tests keep passing.
- Theme setting values: `'light' | 'dark' | 'system'`, default `'system'`.
- Commit after every task with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| File | Responsibility |
|---|---|
| `src/shared/theme.ts` (new) | `Appearance` type, `resolveTheme()`, window background colors. Pure; used by main and renderer. |
| `src/renderer/iconPaths.ts` (new) | `IconName` union and SVG path data. Pure (no DOM) so tests can load it. |
| `src/renderer/icons.ts` (new) | `icon(name, size)` builds the `<svg>` element. |
| `src/renderer/theme.ts` (new) | Applies the theme to `<html>`, follows Windows when set to system, toggles. |
| `src/renderer/core.ts` (new) | App-wide UI state (`ui`), `h()`, `render()`, `run()`, `toast()`, `go()`, view registry, small helpers, keyboard handling. |
| `src/renderer/ui.ts` (new) | Shared builders: button, segmented, toggle, tabs, card, listRow, table, stat, chip, banner, emptyState, field, progress, sectionTitle. |
| `src/renderer/shell.ts` (new) | Sidebar, page header, notices. |
| `src/renderer/views/*.ts` (new) | One file per screen. |
| `src/renderer/renderer.ts` (rewritten) | Entry: imports views, registers them, boots. |
| `src/renderer/css/tokens.css`, `base.css`, `components.css` (new) | Design system. Legacy `styles.css` is kept until Task 18, then deleted. |
| `src/renderer/fonts/*` (new) | Inter woff2 files and OFL license. |
| `scripts/copy-static.mjs` | Copies html, css folder, fonts. |
| `src/shared/types.ts`, `src/main/store.ts`, `src/main/main.ts` | `appearance` setting and native theme. |
| `test/theme.test.ts`, `test/icons.test.ts` (new) | Theme resolution, icon set, emoji scan. |

---

### Task 1: Appearance setting and theme resolution

**Files:**
- Create: `src/shared/theme.ts`
- Modify: `src/shared/types.ts` (interface `Settings`), `src/main/store.ts` (`DEFAULT_SETTINGS`), `src/main/main.ts` (window creation and `engine.on('changed')`)
- Test: `test/theme.test.ts`

**Interfaces:**
- Produces: `type Appearance = 'light' | 'dark' | 'system'`; `resolveTheme(a: Appearance | undefined, systemDark: boolean): 'light' | 'dark'`; `THEME_BG: { light: string; dark: string }`; `Settings.appearance: Appearance`.

- [ ] **Step 1: Write the failing test** `test/theme.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTheme, THEME_BG } from '../src/shared/theme';

describe('theme', () => {
  it('uses the explicit choice', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });
  it('follows Windows for system, and for missing or unknown values', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme(undefined, true), 'dark');
    assert.equal(resolveTheme('purple' as never, false), 'light');
  });
  it('has the Graphite window backgrounds', () => {
    assert.deepEqual(THEME_BG, { light: '#fbfbfc', dark: '#0e0f12' });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: compile error `Cannot find module '../src/shared/theme'`.

- [ ] **Step 3: Implement** `src/shared/theme.ts`

```ts
// Light/dark theme choice, shared by the main process (window color) and the renderer (CSS).
export type Appearance = 'light' | 'dark' | 'system';

export const THEME_BG = { light: '#fbfbfc', dark: '#0e0f12' } as const;

/** The theme to show: the explicit choice, or Windows' setting for "system" and anything unrecognized. */
export function resolveTheme(a: Appearance | undefined, systemDark: boolean): 'light' | 'dark' {
  if (a === 'light' || a === 'dark') return a;
  return systemDark ? 'dark' : 'light';
}
```

In `src/shared/types.ts`, inside `interface Settings` after `userName: string;` add:

```ts
  /** Light, dark, or follow Windows. */
  appearance: import('./theme').Appearance;
```

In `src/main/store.ts` `DEFAULT_SETTINGS`, after `userName: '',` add `appearance: 'system',`.

In `src/main/main.ts`: add `nativeTheme` to the `electron` import and `import { resolveTheme, THEME_BG } from '../shared/theme';`. Add above `createWindow`:

```ts
/** Native controls and the window background follow Pilot's theme, so there's no white flash in dark mode. */
function applyNativeTheme(appearance: Settings['appearance']): void {
  nativeTheme.themeSource = appearance === 'light' || appearance === 'dark' ? appearance : 'system';
  win?.setBackgroundColor(THEME_BG[resolveTheme(appearance, nativeTheme.shouldUseDarkColors)]);
}
```

In the `new BrowserWindow({...})` options add `backgroundColor: THEME_BG[resolveTheme(engine.getState().settings.appearance, nativeTheme.shouldUseDarkColors)],` (if `engine` is not yet created at that point, read `store.data.settings.appearance` instead; check the order in `main.ts`). Inside the existing `engine.on('changed', () => {...})` handler add a check that calls `applyNativeTheme` only when the value changed:

```ts
      const appearance = engine.getState().settings.appearance;
      if (appearance !== lastAppearance) {
        lastAppearance = appearance;
        applyNativeTheme(appearance);
      }
```

with `let lastAppearance: Settings['appearance'] | undefined;` declared next to `let win`. Call `applyNativeTheme(...)` once right after the window is created.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: all tests pass (223), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/theme.ts src/shared/types.ts src/main/store.ts src/main/main.ts test/theme.test.ts
git commit -m "Appearance setting (light/dark/system) and native window theme"
```

---

### Task 2: Design tokens, base CSS, components CSS and Inter

**Files:**
- Create: `src/renderer/css/tokens.css`, `src/renderer/css/base.css`, `src/renderer/css/components.css`, `src/renderer/fonts/` (woff2 + `OFL.txt`)
- Modify: `src/renderer/index.html`, `scripts/copy-static.mjs`, `package.json` (devDependency)

**Interfaces:**
- Produces: CSS classes used by Tasks 5–17 (listed in `components.css` below) and tokens `--bg --side --panel --text --muted --line --line-strong --nav-on --accent --accent-weak --accent-text --on-accent --danger --ok --warn --hover --font`.

- [ ] **Step 1: Get the font files**

Run: `npm view @fontsource/inter@5.3.0 time --json | grep 5.3.0` (confirm it exists and is older than two weeks), then `npm i -D @fontsource/inter@5.3.0`, then copy:

```bash
mkdir -p src/renderer/fonts
cp node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2 node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2 node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2 src/renderer/fonts/
cp node_modules/@fontsource/inter/LICENSE src/renderer/fonts/OFL.txt
```

Expected: three `.woff2` files (about 20–30 KB each) and `OFL.txt`.

- [ ] **Step 2: Write `src/renderer/css/tokens.css`**

```css
@font-face { font-family: "Inter"; font-weight: 400; font-style: normal; font-display: swap; src: url("../fonts/inter-latin-400-normal.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 500; font-style: normal; font-display: swap; src: url("../fonts/inter-latin-500-normal.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; font-style: normal; font-display: swap; src: url("../fonts/inter-latin-600-normal.woff2") format("woff2"); }

:root {
  --font: "Inter", "Segoe UI", system-ui, sans-serif;
  --bg: #fbfbfc; --side: #f4f5f7; --panel: #ffffff; --text: #111318; --muted: #6b7180;
  --line: #e7e9ee; --line-strong: #d5d9e1; --nav-on: #e8ebf1; --hover: #f2f4f7;
  --accent: #2b59d9; --accent-weak: #e9effc; --accent-text: #2b59d9; --on-accent: #ffffff;
  --danger: #d43c3c; --ok: #1f9d63; --warn: #b7791f;
  /* legacy names still used by styles.css until Task 18 */
  --chip: var(--nav-on); --p1: var(--danger); --p2: var(--accent); --p3: var(--line-strong); --accent-text-legacy: var(--on-accent);
  --r-ctl: 5px; --r-card: 6px; --r-frame: 8px;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #0e0f12; --side: #121418; --panel: #16181d; --text: #e9ebf0; --muted: #8a909c;
  --line: #23262d; --line-strong: #30343c; --nav-on: #1e2128; --hover: #1b1e24;
  --accent: #5b84f2; --accent-weak: #1a2440; --accent-text: #86a5f7; --on-accent: #0b1020;
  --danger: #f06a6a; --ok: #3ccf8e; --warn: #e3a64a;
  color-scheme: dark;
}
```

- [ ] **Step 3: Write `src/renderer/css/base.css`**

```css
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 12.5px/1.5 var(--font); -webkit-font-smoothing: antialiased; transition: background-color .15s, color .15s; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--accent-text); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.small { font-size: 11.5px; }

/* shell */
.g-shell { display: grid; grid-template-columns: 188px 1fr; height: 100vh; }
.g-side { background: var(--side); border-right: 1px solid var(--line); padding: 14px 9px; display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }
.g-brand { display: flex; align-items: center; gap: 8px; padding: 2px 8px 12px; font-weight: 600; font-size: 13.5px; letter-spacing: -.01em; }
.g-brand .mark { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; }
.g-brand small { display: block; font-weight: 400; font-size: 11px; color: var(--muted); }
.g-nav { display: flex; align-items: center; gap: 9px; padding: 5px 8px; border-radius: var(--r-ctl); color: var(--muted); border: 0; background: none; text-align: left; cursor: pointer; font-size: 12.5px; }
.g-nav:hover { background: var(--hover); color: var(--text); }
.g-nav.on { background: var(--nav-on); color: var(--text); font-weight: 500; }
.g-nav .n { margin-left: auto; font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.g-nav.on .n { color: var(--accent-text); }
.g-side-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px; font-size: 11.5px; color: var(--muted); }
.g-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
.g-dot.off { background: var(--line-strong); }
.g-main { overflow-y: auto; padding: 18px 22px 40px; }
.g-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.g-head h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
.g-head .status { color: var(--muted); font-size: 11.5px; margin-left: auto; }
.g-head .status.warn { color: var(--warn); }
.g-grid2 { display: grid; grid-template-columns: 1.55fr 1fr; gap: 14px; align-items: start; }
.g-grid2.eq { grid-template-columns: 1fr 1fr; }
@media (max-width: 900px) { .g-grid2, .g-grid2.eq { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Write `src/renderer/css/components.css`**

```css
.g-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--r-ctl); border: 1px solid var(--line-strong); background: var(--panel); color: var(--text); font-size: 12px; cursor: pointer; white-space: nowrap; }
.g-btn:hover { background: var(--hover); }
.g-btn:disabled { opacity: .55; cursor: default; }
.g-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.g-btn.primary:hover { filter: brightness(1.06); }
.g-btn.ghost { border-color: transparent; background: none; color: var(--muted); }
.g-btn.ghost:hover { color: var(--text); background: var(--hover); }
.g-btn.danger { color: var(--danger); }
.g-btn.tiny { padding: 1px 7px; font-size: 11.5px; }
.g-seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--r-ctl); overflow: hidden; }
.g-seg button { border: 0; border-left: 1px solid var(--line-strong); background: var(--panel); color: var(--muted); padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
.g-seg button:first-child { border-left: 0; }
.g-seg button.on { background: var(--nav-on); color: var(--text); font-weight: 500; }
.g-toggle { width: 30px; height: 17px; border-radius: 9px; background: var(--line-strong); position: relative; border: 0; cursor: pointer; flex: none; padding: 0; }
.g-toggle i { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--panel); transition: left .15s; }
.g-toggle.on { background: var(--accent); }
.g-toggle.on i { left: 15px; }
.g-tabs { display: flex; gap: 2px; align-items: center; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.g-tab { border: 0; background: none; padding: 6px 10px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; font-size: 12px; display: inline-flex; gap: 6px; }
.g-tab.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 500; }
.g-tab i { font-style: normal; font-size: 10.5px; color: var(--muted); }
.g-tabs .g-spacer { flex: 1; }
.g-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-card); }
.g-card.pad { padding: 12px 14px; }
.g-card.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.g-sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 14px 0 6px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
.g-sec:first-child { margin-top: 0; }
.g-sec .cnt { font-size: 10px; border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 5px; letter-spacing: 0; }
.g-list { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-card); overflow: hidden; }
.g-row { display: grid; grid-template-columns: 8px 1fr auto; gap: 10px; padding: 9px 12px; border-top: 1px solid var(--line); align-items: start; cursor: default; }
.g-row:first-child { border-top: 0; }
.g-row.click { cursor: pointer; }
.g-row.click:hover { background: var(--hover); }
.g-row.sel { background: var(--accent-weak); box-shadow: inset 2px 0 0 var(--accent); }
.g-pri { width: 6px; height: 6px; border-radius: 50%; margin-top: 6px; background: var(--line-strong); }
.g-pri.p1 { background: var(--danger); } .g-pri.p2 { background: var(--accent); }
.g-row .t { font-weight: 600; display: flex; gap: 6px; align-items: center; min-width: 0; }
.g-row .s { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.g-row .r { font-size: 11px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.g-table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-card); overflow: hidden; }
.g-table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; text-align: left; background: var(--side); padding: 6px 12px; border-bottom: 1px solid var(--line); }
.g-table td { padding: 9px 12px; border-top: 1px solid var(--line); vertical-align: middle; }
.g-table tr:first-child td { border-top: 0; }
.g-table .r { text-align: right; }
.g-table tr.click { cursor: pointer; } .g-table tr.click:hover td { background: var(--hover); }
.g-table tr.sel td { background: var(--accent-weak); }
.g-stats { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--panel); }
.g-stats div { padding: 9px 12px; border-left: 1px solid var(--line); }
.g-stats div:first-child { border-left: 0; }
.g-stats b { display: block; font-size: 17px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.g-stats span { font-size: 11px; color: var(--muted); }
.g-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--line-strong); color: var(--muted); font-weight: 500; white-space: nowrap; line-height: 17px; }
.g-chip.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.g-chip.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.g-chip.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.g-chip.accent { color: var(--accent-text); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.g-banner { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--r-card); background: var(--panel); padding: 10px 14px; margin-bottom: 12px; }
.g-banner.warn { border-left-color: var(--warn); } .g-banner.danger { border-left-color: var(--danger); } .g-banner.ok { border-left-color: var(--ok); }
.g-banner .body { flex: 1; } .g-banner .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.g-empty { color: var(--muted); padding: 28px 12px; text-align: center; border: 1px dashed var(--line-strong); border-radius: var(--r-card); }
.g-field { margin-bottom: 12px; }
.g-field > label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; }
.g-field .hint, .g-hint { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
.g-input, .g-field input[type="text"], .g-field input[type="number"], .g-field input[type="email"], .g-field input[type="password"], .g-field select, .g-field textarea { width: 100%; border: 1px solid var(--line-strong); border-radius: var(--r-ctl); background: var(--panel); padding: 6px 10px; }
.g-progress { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; margin-top: 6px; }
.g-progress i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.g-progress.indet i { width: 30%; animation: g-indet 1.2s linear infinite; }
@keyframes g-indet { from { margin-left: -30%; } to { margin-left: 100%; } }
.g-acts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.g-acts .g-spacer { flex: 1; }
.g-kbd { font-size: 10.5px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; color: var(--muted); }
.g-skel { height: 12px; border-radius: 3px; background: var(--line); margin: 6px 0; animation: g-pulse 1.2s ease-in-out infinite; }
@keyframes g-pulse { 50% { opacity: .5; } }
svg.g-i { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
#toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 8px 14px; border-radius: var(--r-ctl); font-size: 12.5px; opacity: 0; pointer-events: none; transition: opacity .15s; display: flex; gap: 12px; align-items: center; }
#toast.show { opacity: 1; } #toast.actionable.show { pointer-events: auto; }
.toast-action { background: none; border: 0; color: var(--bg); font-weight: 600; text-decoration: underline; cursor: pointer; padding: 0; }
.keys-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); display: grid; place-items: center; z-index: 50; }
.keys-box { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-frame); padding: 18px 22px; min-width: 340px; box-shadow: 0 12px 32px rgba(0, 0, 0, .25); }
.keys-box h3 { margin: 0 0 10px; font-size: 13.5px; }
.keys-box td { padding: 4px 14px 4px 0; }
```

- [ ] **Step 5: Link the CSS and copy it in the build**

`src/renderer/index.html` `<head>`: replace `<link rel="stylesheet" href="styles.css" />` with

```html
    <link rel="stylesheet" href="css/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
    <link rel="stylesheet" href="css/base.css" />
    <link rel="stylesheet" href="css/components.css" />
```

`scripts/copy-static.mjs`:

```js
// Copies the renderer's static files (html, css, fonts) next to its compiled JS.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('dist/web/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  if (existsSync(`src/renderer/${file}`)) cpSync(`src/renderer/${file}`, `dist/web/renderer/${file}`);
}
for (const dir of ['css', 'fonts']) cpSync(`src/renderer/${dir}`, `dist/web/renderer/${dir}`, { recursive: true });
```

In legacy `src/renderer/styles.css`, delete the `:root { ... }` and `@media (prefers-color-scheme: dark) { :root { ... } }` blocks at the top (tokens.css owns colors now) and the `#toast` rules (components.css owns them).

- [ ] **Step 6: Build and look**

Run: `npm run build`, then the demo screenshot harness (see Task 18, Step 3) for Today.
Expected: app renders with Inter and the new colors; layout still the old one. No console errors about fonts.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/css src/renderer/fonts src/renderer/index.html src/renderer/styles.css scripts/copy-static.mjs package.json package-lock.json
git commit -m "Graphite design tokens, base and component CSS, bundled Inter"
```

---

### Task 3: SVG icon set and the no-emoji guard

**Files:**
- Create: `src/renderer/iconPaths.ts`, `src/renderer/icons.ts`
- Modify: `tsconfig.test.json` (include `src/renderer/iconPaths.ts`)
- Test: `test/icons.test.ts`

**Interfaces:**
- Produces: `type IconName`; `ICON_PATHS: Record<IconName, string>`; `icon(name: IconName, size?: number): SVGSVGElement` (class `g-i`).

- [ ] **Step 1: Write the failing test** `test/icons.test.ts`

```ts
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { ICON_PATHS } from '../src/renderer/iconPaths';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(ts|html|css)$/.test(d.name) ? [p] : [];
  });
}

describe('icons', () => {
  it('has path data for every icon', () => {
    const names = Object.keys(ICON_PATHS);
    assert.ok(names.length >= 35, `only ${names.length} icons`);
    for (const n of names) assert.match(ICON_PATHS[n as keyof typeof ICON_PATHS], /<(path|circle|rect|polyline|line)\b/, n);
  });
  it('the renderer contains no emoji', () => {
    const root = path.join(process.cwd(), 'src', 'renderer');
    for (const f of files(root)) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        assert.ok(!EMOJI.test(line), `${path.relative(root, f)}:${i + 1} contains an emoji`);
      });
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test` — Expected: `Cannot find module '../src/renderer/iconPaths'`.

- [ ] **Step 3: Implement `src/renderer/iconPaths.ts`**

```ts
// Path data for every icon in the app: 24x24, drawn as 1.6px strokes in the current text color.
export const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  rules: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pilot: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  snooze: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8 8 0 0 0 14.9 3.5L21 14"/><path d="M21 20v-6h-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  thumbUp: '<path d="m18 15-6-6-6 6"/><path d="M12 9v12"/>',
  thumbDown: '<path d="m6 9 6 6 6-6"/><path d="M12 15V3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;
```

`src/renderer/icons.ts`:

```ts
import { ICON_PATHS, type IconName } from './iconPaths.js';

export type { IconName };

/** An inline SVG icon from the app's one icon set. */
export function icon(name: IconName, size = 15): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'g-i');
  // Static, trusted markup from ICON_PATHS (never user data).
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}
```

`tsconfig.test.json` `include`: add `"src/renderer/iconPaths.ts"`.

- [ ] **Step 4: Run tests** — `npm test`. Expected: all pass (225).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/iconPaths.ts src/renderer/icons.ts tsconfig.test.json test/icons.test.ts
git commit -m "SVG icon set and a test that keeps emoji out of the renderer"
```

---

### Task 4: Split the renderer into core, entry and view modules (no visual change)

**Files:**
- Create: `src/renderer/core.ts`, `src/renderer/views/{onboarding,mailboxes,subscriptions,updates,deadlines,ask,notifications,today,followups,activity,rules,replies,settings,aisetup}.ts`
- Modify: `src/renderer/renderer.ts` (becomes the entry)

**Interfaces:**
- Produces (from `core.ts`):
  - `type View = 'today' | 'ask' | 'updates' | 'deadlines' | 'followups' | 'mailboxes' | 'subscriptions' | 'activity' | 'sorting' | 'rules' | 'notifications' | 'settings'`
  - `const api: Api`
  - `const ui: { state: AppState; view: View; tab: 'open' | 'done'; onboardStep: 'name' | 'ai' | 'mail'; addFlow: AddFlow | null; deferredRender: boolean; selectedKey: string | null; snoozeFor: string | null; remindFor: string | null; remindText: string; remindPreview: string }`
  - `const editors: Map<string, string>`, `showOriginal: Set<string>`, `bodies: Map<string, string>`, `showThread: Set<string>`, `openPerms: Set<string>`
  - `h()`, `type Child`, `btn()`, `valueOf()`, `accountOf()`, `go(v: View)`, `render()`, `run(fn, done?)`, `toast(text, action?)`, `relTime(ms)`, `CAT_LABEL`
  - `registerView(v: View, fn: () => HTMLElement)`, `registerChrome(fns: { nav: () => HTMLElement; header: () => HTMLElement; notice: () => HTMLElement | null; onboarding: () => HTMLElement })`
- Every view module exports its `renderX` function(s) with the same names as today.

Rule for the move: copy functions **verbatim**; only change references to module-level variables that now live in `ui` (for example `state` → `ui.state`, `view` → `ui.view`, `tab = 'open'` → `ui.tab = 'open'`). Variables used by only one screen move into that screen's module unchanged (for example `askText`, `ruleText`, `cleanup`, `styleBusy`, `aiStatus`, `deadlineKind`, `activityFilter`, `replyAlts`).

- [ ] **Step 1: Create `core.ts`** with the shared state and helpers. Its render loop uses the registry:

```ts
const views = new Map<View, () => HTMLElement>();
let chrome: { nav: () => HTMLElement; header: () => HTMLElement; notice: () => HTMLElement | null; onboarding: () => HTMLElement };

export function registerView(v: View, fn: () => HTMLElement): void { views.set(v, fn); }
export function registerChrome(c: typeof chrome): void { chrome = c; }

export function render(): void {
  const root = document.getElementById('app')!;
  if (!ui.state.settings.onboarded) {
    root.replaceChildren(chrome.onboarding());
    return;
  }
  const view = views.get(ui.view)!;
  root.replaceChildren(h('div', { class: 'layout' }, chrome.nav(), h('main', {}, chrome.header(), chrome.notice(), view())));
}
```

Move into `core.ts` verbatim: `h`, `Child`, `btn`, `valueOf`, `accountOf`, `go`, `onState` (exported), the `focusout` listener, `toast` (+ `toastTimer`), `run`, `relTime`, `CAT_LABEL`, `quickAct`, `openReply`, the whole keyboard block (`selectedKey` → `ui.selectedKey`, `SHORTCUTS`, `visibleCards`, `select`, `keysOverlay`, `pendingG`, the `keydown` listener).

- [ ] **Step 2: Move each screen** into its file under `views/` (grouping helpers with the screen that uses them):
  - `onboarding.ts`: `renderOnboarding`, `serverFields`, `renderAddMailbox`.
  - `aisetup.ts`: `aiStatus`, `aiBusy`, `aiPoll`, `refreshAi`, `aiSetupPanel`.
  - `mailboxes.ts`: `renderMailboxes` and its permission helpers.
  - `subscriptions.ts`: `renderSubscriptions`, `subscriptionRow`, `cleanup`, `cleanupBox`.
  - `updates.ts`: `renderUpdates`, `group`, `groupedCards`, `replyLine`, `autoLine`, `renderBriefing`, `card`, `keyDates`, `whyLine`, `proposalsFor`, `conversation`, `correctionBar`, `replyEditor`, `replyAlts`, `snoozeBox`, `snoozeText`.
  - `deadlines.ts`, `ask.ts`, `notifications.ts`, `today.ts` (with `agenda`, `greeting`, `weekCard`, `itemsDueSoon`, `dueCount`), `followups.ts` (with `remindBox`, `openRemind`), `activity.ts`, `rules.ts` (the Rules page: `renderSorting`, `plainRuleBox`, `suggestedRow`, `ruleRow`, `effectFrom`, `ruleEffectLabel`), `replies.ts` (the Replies page: `renderRules`, `styleBlock`), `settings.ts` (`renderSettings`, `field`, `check`, `text`, stats table).
  - `renderNav`, `renderHeader`, `renderNotice` go to `src/renderer/shell.ts` for now (restyled in Task 6).
  - Cross-screen calls become imports, for example `today.ts` imports `aiSetupPanel` from `./aisetup.js` and `card` from `./updates.js`.

- [ ] **Step 3: Rewrite `renderer.ts` as the entry**

```ts
import { api, onState, registerChrome, registerView, render, ui } from './core.js';
import { renderHeader, renderNav, renderNotice } from './shell.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderToday } from './views/today.js';
import { renderAsk } from './views/ask.js';
import { renderUpdates } from './views/updates.js';
import { renderDeadlines } from './views/deadlines.js';
import { renderFollowUps } from './views/followups.js';
import { renderMailboxes } from './views/mailboxes.js';
import { renderSubscriptions } from './views/subscriptions.js';
import { renderActivity } from './views/activity.js';
import { renderSorting } from './views/rules.js';
import { renderRules } from './views/replies.js';
import { renderNotifications } from './views/notifications.js';
import { renderSettings } from './views/settings.js';

registerChrome({ nav: renderNav, header: renderHeader, notice: renderNotice, onboarding: renderOnboarding });
registerView('today', renderToday);
registerView('ask', renderAsk);
registerView('updates', renderUpdates);
registerView('deadlines', renderDeadlines);
registerView('followups', renderFollowUps);
registerView('mailboxes', renderMailboxes);
registerView('subscriptions', renderSubscriptions);
registerView('activity', renderActivity);
registerView('sorting', renderSorting);
registerView('rules', renderRules);
registerView('notifications', renderNotifications);
registerView('settings', renderSettings);

api.onState(onState);
api.getState().then((s) => {
  ui.state = s;
  if (s.settings.userName) ui.onboardStep = 'mail';
  render();
});
```

- [ ] **Step 4: Typecheck, test, compare**

Run: `npm run typecheck && npm test && npm run build`, then the demo screenshot harness with the steps file `steps-keys.json` from earlier work (Today, Updates, j/k, Done then Undo, `?`, rule preview).
Expected: no type errors; 225 tests pass; screenshots match the pre-split app (same layout, new colors from Task 2); the harness log shows `TOAST Undone`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "Split the renderer into core, shell and one module per screen (no visual change)"
```

---

### Task 5: Shared UI builders and theme module

**Files:**
- Create: `src/renderer/ui.ts`, `src/renderer/theme.ts`

**Interfaces:**
- Consumes: `h`, `Child` from `core.ts`; `icon`, `IconName` from `icons.ts`; `resolveTheme`, `Appearance` from `../shared/theme.js`.
- Produces (`ui.ts`): 
  - `button(label: string, opts: { onClick: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; tiny?: boolean; title?: string }): HTMLButtonElement`
  - `segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement`
  - `toggle(checked: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement`
  - `tabs<T extends string>(items: { id: T; label: string; count?: number }[], active: T, onSelect: (id: T) => void, right?: Child): HTMLElement`
  - `card(children: Child[], opts?: { pad?: boolean; selected?: boolean }): HTMLElement`
  - `sectionTitle(text: string, count?: number): HTMLElement`
  - `listRow(o: { dot?: 'p1' | 'p2' | 'low' | null; title: Child; sub?: Child; right?: Child; selected?: boolean; onClick?: () => void; key?: string }): HTMLElement`
  - `table(columns: { label: string; align?: 'right' }[], rows: { cells: Child[]; selected?: boolean; onClick?: () => void }[]): HTMLTableElement`
  - `stats(items: { value: string; label: string }[]): HTMLElement`
  - `chip(text: string, tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'): HTMLElement`
  - `banner(kind: 'info' | 'warn' | 'danger' | 'ok', body: Child[], actions?: Node[]): HTMLElement`
  - `emptyState(text: string, action?: Node): HTMLElement`
  - `field(label: string, input: HTMLElement, hint?: string): HTMLElement`
  - `progress(percent?: number): HTMLElement`
  - `skeleton(lines?: number): HTMLElement`
- Produces (`theme.ts`): `initTheme(get: () => Appearance): void`, `applyTheme(a: Appearance): void`, `nextTheme(a: Appearance): 'light' | 'dark'`.

- [ ] **Step 1: Write `src/renderer/theme.ts`**

```ts
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
```

In `renderer.ts`, before `render()` in the boot block, add `initTheme(() => ui.state.settings.appearance);`, and in `core.ts` `onState`, call `applyTheme(next.settings.appearance)` first.

- [ ] **Step 2: Write `src/renderer/ui.ts`**

```ts
// Shared building blocks for every screen, so classes and markup live in one place.
import { h, type Child } from './core.js';
import { icon, type IconName } from './icons.js';

export function button(label: string, o: { onClick: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; tiny?: boolean; title?: string }): HTMLButtonElement {
  const cls = ['g-btn', o.kind && o.kind !== 'default' ? o.kind : '', o.tiny ? 'tiny' : ''].filter(Boolean).join(' ');
  return h('button', { class: cls, type: 'button', onclick: o.onClick, disabled: !!o.disabled, title: o.title }, o.icon ? icon(o.icon, 14) : null, label);
}

export function segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  return h('div', { class: 'g-seg', role: 'radiogroup' },
    options.map((o) => h('button', { type: 'button', class: o.value === value ? 'on' : '', role: 'radio', 'aria-checked': String(o.value === value), onclick: () => onChange(o.value) }, o.label)));
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement {
  return h('button', { type: 'button', class: `g-toggle${checked ? ' on' : ''}`, role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onclick: () => onChange(!checked) }, h('i', {}));
}

export function tabs<T extends string>(items: { id: T; label: string; count?: number }[], active: T, onSelect: (id: T) => void, right?: Child): HTMLElement {
  return h('div', { class: 'g-tabs', role: 'tablist' },
    items.map((t) => h('button', { type: 'button', role: 'tab', class: `g-tab${t.id === active ? ' on' : ''}`, onclick: () => onSelect(t.id) }, t.label, t.count !== undefined ? h('i', {}, String(t.count)) : null)),
    right ? h('span', { class: 'g-spacer' }) : null, right ?? null);
}

export function card(children: Child[], o: { pad?: boolean; selected?: boolean } = {}): HTMLElement {
  return h('div', { class: `g-card${o.pad === false ? '' : ' pad'}${o.selected ? ' sel' : ''}` }, ...children);
}

export function sectionTitle(text: string, count?: number): HTMLElement {
  return h('div', { class: 'g-sec' }, text, count !== undefined ? h('span', { class: 'cnt' }, String(count)) : null);
}

export function listRow(o: { dot?: 'p1' | 'p2' | 'low' | null; title: Child; sub?: Child; right?: Child; selected?: boolean; onClick?: () => void; key?: string }): HTMLElement {
  return h('div', { class: `g-row${o.onClick ? ' click' : ''}${o.selected ? ' sel' : ''}`, onclick: o.onClick, 'data-key': o.key },
    o.dot === null ? h('span', {}) : h('span', { class: `g-pri ${o.dot ?? 'low'}` }),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, o.title), o.sub ? h('div', { class: 's' }, o.sub) : null),
    h('span', { class: 'r' }, o.right ?? null));
}

export function table(columns: { label: string; align?: 'right' }[], rows: { cells: Child[]; selected?: boolean; onClick?: () => void }[]): HTMLTableElement {
  return h('table', { class: 'g-table' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'r' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: `${r.onClick ? 'click' : ''}${r.selected ? ' sel' : ''}`, onclick: r.onClick },
      r.cells.map((cell, i) => h('td', { class: columns[i]?.align === 'right' ? 'r' : '' }, cell))))));
}

export function stats(items: { value: string; label: string }[]): HTMLElement {
  return h('div', { class: 'g-stats' }, items.map((s) => h('div', {}, h('b', {}, s.value), h('span', {}, s.label))));
}

export function chip(text: string, tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' = 'neutral'): HTMLElement {
  return h('span', { class: `g-chip${tone === 'neutral' ? '' : ` ${tone}`}` }, text);
}

export function banner(kind: 'info' | 'warn' | 'danger' | 'ok', body: Child[], actions: Node[] = []): HTMLElement {
  return h('div', { class: `g-banner${kind === 'info' ? '' : ` ${kind}`}`, role: kind === 'danger' ? 'alert' : 'status' },
    h('div', { class: 'body' }, ...body), actions.length ? h('div', { class: 'acts' }, ...actions) : null);
}

export function emptyState(text: string, action?: Node): HTMLElement {
  return h('div', { class: 'g-empty' }, h('div', {}, text), action ? h('div', { class: 'g-acts', style: 'justify-content:center' }, action) : null);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'g-field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function progress(percent?: number): HTMLElement {
  return percent === undefined
    ? h('div', { class: 'g-progress indet' }, h('i', {}))
    : h('div', { class: 'g-progress', role: 'progressbar', 'aria-valuenow': String(percent) }, h('i', { style: `width:${Math.max(0, Math.min(100, percent))}%` }));
}

export function skeleton(lines = 3): HTMLElement {
  return h('div', { class: 'g-card pad' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'g-skel', style: `width:${90 - i * 15}%` })));
}
```

Note: `h()` sets known DOM properties directly and other keys as attributes, so `role`, `aria-*`, `data-key` and `style` strings work as attributes; `disabled` false is skipped by `h()`.

- [ ] **Step 3: Typecheck and build** — `npm run typecheck && npm run build`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui.ts src/renderer/theme.ts src/renderer/renderer.ts src/renderer/core.ts
git commit -m "Shared UI builders and the theme module"
```

---

### Task 6: Shell: sidebar, header, notices, theme button

**Files:**
- Modify: `src/renderer/shell.ts`, `src/renderer/core.ts` (`render()` wrapper classes)

**Interfaces:**
- Consumes: `ui`, `go`, `h`, `run`, `api`, `relTime` (core); `button`, `banner` (ui); `icon` (icons); `nextTheme` (theme).
- Produces: `renderNav(): HTMLElement`, `renderHeader(): HTMLElement`, `renderNotice(): HTMLElement | null`, `pageTitle(v: View): string`.

- [ ] **Step 1: In `core.ts` `render()`** change the wrapper to `h('div', { class: 'g-shell' }, chrome.nav(), h('main', { class: 'g-main' }, chrome.header(), chrome.notice(), view()))`, and in `onState` replace `document.querySelector('nav')` with `document.querySelector('.g-side')` and `header.top` with `.g-head`.

- [ ] **Step 2: Rewrite `renderNav` in `shell.ts`**

```ts
const NAV: { v: View; label: string; icon: IconName }[] = [
  { v: 'today', label: 'Today', icon: 'home' }, { v: 'updates', label: 'Updates', icon: 'inbox' }, { v: 'ask', label: 'Ask', icon: 'search' },
  { v: 'deadlines', label: 'Deadlines', icon: 'calendar' }, { v: 'followups', label: 'Follow-ups', icon: 'reply' }, { v: 'mailboxes', label: 'Mailboxes', icon: 'mail' },
  { v: 'subscriptions', label: 'Subscriptions', icon: 'news' }, { v: 'activity', label: 'Activity', icon: 'list' }, { v: 'sorting', label: 'Rules', icon: 'rules' },
  { v: 'rules', label: 'Replies', icon: 'pen' }, { v: 'notifications', label: 'Notifications', icon: 'bell' }, { v: 'settings', label: 'Settings', icon: 'gear' },
];

export function renderNav(): HTMLElement {
  const s = ui.state;
  const counts: Partial<Record<View, string>> = {
    updates: count(s.updates.filter((u) => u.status === 'new').length),
    ask: 'Ctrl K',
    deadlines: count(itemsDueSoon()),
    followups: count(dueCount()),
    subscriptions: count(s.subscriptions.filter((x) => !x.unsubscribedAt && x.count >= 2).length),
    activity: count(s.activity.filter((a) => a.status === 'proposed').length),
    sorting: count(s.suggestedRules.length),
    notifications: count(s.notifier.held),
  };
  const watching = s.accounts.filter((a) => a.watching).length;
  const themeIcon = document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon';
  return h('aside', { class: 'g-side' },
    h('div', { class: 'g-brand' }, h('span', { class: 'mark' }, icon('pilot', 12)),
      h('div', {}, 'Inbox Pilot', h('small', {}, s.status.demo ? 'Demo mode' : s.settings.userName ? `${s.settings.userName}'s Pilot` : 'Your email Pilot'))),
    NAV.map((n) => h('button', { type: 'button', class: `g-nav${ui.view === n.v ? ' on' : ''}`, onclick: () => go(n.v), 'aria-current': ui.view === n.v ? 'page' : null },
      icon(n.icon), n.label, counts[n.v] ? h('span', { class: 'n' }, counts[n.v]!) : null)),
    h('div', { class: 'g-side-foot' },
      h('span', { class: `g-dot${watching ? '' : ' off'}` }),
      watching ? `Watching ${watching} mailbox${watching === 1 ? '' : 'es'}` : 'Not watching',
      h('span', { style: 'flex:1' }),
      button('', { kind: 'ghost', icon: themeIcon, title: 'Switch light or dark', onClick: () => void run(() => api.saveSettings({ appearance: nextTheme(s.settings.appearance) })) })));
}

const count = (n: number) => (n ? String(n) : undefined);
```

`itemsDueSoon` and `dueCount` are imported from `./views/today.js`.

- [ ] **Step 3: Rewrite `renderHeader` and `renderNotice`**

```ts
export function pageTitle(v: View): string {
  return { today: 'Today', ask: 'Ask my inbox', updates: 'Updates', deadlines: 'Deadlines and bills', followups: 'Follow-ups', mailboxes: 'Mailboxes',
    subscriptions: 'Subscriptions', activity: 'Activity', sorting: 'Rules', rules: 'Replies', notifications: 'Notifications', settings: 'Settings' }[v];
}

export function renderHeader(): HTMLElement {
  const s = ui.state.status;
  const msg = s.message ?? (s.lastRunAt ? `Checked ${relTime(s.lastRunAt)}` : '');
  return h('header', { class: 'g-head' },
    h('h1', {}, pageTitle(ui.view)),
    h('span', { class: `status${s.ollamaOk === false ? ' warn' : ''}` }, msg),
    button(s.syncing ? 'Checking…' : 'Check now', { icon: 'refresh', disabled: s.syncing, onClick: () => void run(() => api.syncNow()) }));
}

export function renderNotice(): HTMLElement | null {
  const n = ui.state.app.notice;
  if (!n) return null;
  return banner('warn', [h('strong', {}, 'Heads up. '), n], [button('Dismiss', { kind: 'ghost', onClick: () => void run(() => api.dismissNotice()) })]);
}
```

- [ ] **Step 4: Build and screenshot** Today in light and dark (Task 18 Step 3 harness; dark via `document.documentElement.dataset.theme='dark'`). Expected: sidebar matches the mockup shell (icons, counts, footer with dot and theme button); clicking the theme button switches theme and persists after restart.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell.ts src/renderer/core.ts
git commit -m "Graphite shell: icon sidebar, header, notices, theme button"
```

---

### Task 7: Today (two columns)

**Files:** Modify `src/renderer/views/today.ts`

**Interfaces:** Consumes `ui`, `h`, `go`, `run`, `api`, `relTime`, `accountOf` (core); `sectionTitle`, `listRow`, `stats`, `card`, `banner`, `button`, `chip`, `emptyState` (ui); `icon`; `aiSetupPanel` (views/aisetup). Produces `renderToday()`, `itemsDueSoon()`, `dueCount()`, `agenda()`, `greeting()`.

- [ ] **Step 1: Replace `renderToday` and `weekCard`** with the two-column layout. Keep `agenda()`, `greeting()`, `itemsDueSoon()`, `dueCount()` unchanged.

```ts
export function renderToday(): HTMLElement {
  const s = ui.state;
  const wrap = h('div', {});
  for (const a of s.accounts.filter((x) => x.needsReconnect && x.kind !== 'imap')) {
    wrap.append(banner('warn', [h('strong', {}, `${a.email} needs to be reconnected. `), 'The sign-in expired (Google does this weekly while the app is in Testing). Your data is kept.'],
      [button('Reconnect', { kind: 'primary', onClick: () => void run(() => api.connect({ email: a.email, kind: a.kind, providerName: a.providerName, access: a.access ?? 'full', calendar: a.calendar }), 'Reconnected. Checking mail…') })]));
  }
  const up = s.app.update;
  if (up?.available && up.url) wrap.append(banner('info', [h('strong', {}, `Pilot ${up.latest} is available. `), `You have ${s.app.version}.`], [button('Download', { kind: 'primary', icon: 'download', onClick: () => void run(() => api.openUrl(up.url!)) })]));
  if (s.status.ollamaOk === false) wrap.append(h('div', { style: 'margin-bottom:12px' }, aiSetupPanel()));
  if (!s.accounts.some((a) => a.watching)) {
    wrap.append(emptyState("Pilot isn't watching any mailbox yet.", button('Go to Mailboxes', { kind: 'primary', onClick: () => go('mailboxes') })));
    return wrap;
  }
  const b = s.briefing;
  if (b && new Date(b.at).toDateString() === new Date().toDateString()) {
    wrap.append(card([h('div', { class: 'g-sec', style: 'color:var(--accent-text)' }, icon('spark', 13), `Briefing · ${relTime(b.at)}`), h('p', { style: 'margin:0;max-width:72ch' }, b.text)]), h('div', { style: 'height:12px' }));
  }
  const open = s.updates.filter((u) => u.status === 'new');
  const needYou = open.filter((u) => u.triage?.priority === 1 || (u.triage?.needsReply && !u.triage.repliedAlready)).slice(0, 6);
  const w = s.weekly;
  const left = h('div', {},
    sectionTitle('Needs you', needYou.length),
    needYou.length
      ? h('div', { class: 'g-list' }, needYou.map((u) => listRow({
          dot: u.triage?.priority === 1 ? 'p1' : 'p2',
          title: [u.message.from.name || u.message.from.email, u.triage ? chip(CAT_LABEL[u.triage.category]) : null],
          sub: h('span', {}, h('span', { style: 'color:var(--text)' }, u.message.subject || '(no subject)'), u.triage ? ` · ${u.triage.summary}` : ''),
          right: relTime(u.message.receivedAt),
          onClick: () => { ui.selectedKey = u.key; go('updates'); },
        })))
      : emptyState("Nothing needs you right now."),
    sectionTitle('Your week'),
    stats([{ value: String(w.received), label: 'emails' }, { value: String(w.important), label: 'important' }, { value: String(w.owed), label: 'you owe' },
      { value: w.billTotal !== undefined && w.currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency: w.currency, maximumFractionDigits: 0 }).format(w.billTotal) : String(w.bills), label: w.billTotal !== undefined ? 'due in 2 weeks' : 'bills soon' }]),
    w.noisiest.length ? h('div', { class: 'g-hint', style: 'margin-top:6px' }, `Noisiest: ${w.noisiest.map((n) => `${n.name} (${n.count})`).join(', ')} `, button('Clean up', { tiny: true, kind: 'ghost', onClick: () => go('subscriptions') })) : null);
  const right = h('div', {}, sectionTitle('Coming up'), agendaList(), sectionTitle('Waiting on'), waitingList());
  wrap.append(h('div', { class: 'g-grid2' }, left, right));
  return wrap;
}
```

Add `agendaList()` (renders `agenda()` entries as `.g-list` rows: date column `Mon<br>Oct 26` in muted tabular figures, kind icon `bill`/`calendar`/`clock`/`reply`, title, amount right-aligned; click opens the source email as today's agenda rows do) and `waitingList()` (from `ui.state.followUps.filter((f) => f.status === 'waiting')`: recipient, subject, age in days with `chip(..., 'warn')` when overdue). Reuse the click handlers from the current agenda rendering.

- [ ] **Step 2: Build, screenshot light and dark, compare with mockup "Today A".** Expected: same structure; briefing card on top when today's exists; clicking a Needs-you row opens Updates with that email selected.

- [ ] **Step 3: Commit** — `git commit -am "Today in two columns"`

---

### Task 8: Updates with a reading pane

**Files:** Modify `src/renderer/views/updates.ts`, `src/renderer/core.ts` (keyboard: `visibleCards` selector), `src/renderer/css/components.css` (pane styles)

**Interfaces:** Consumes everything already in `updates.ts` plus `ui.selectedKey`. Produces `renderUpdates()`, `emailPane(u: Update): HTMLElement`, keeps `card` exported as an alias of `emailPane` for Today's old callers.

- [ ] **Step 1: Add pane CSS** to `components.css`

```css
.g-split { display: grid; grid-template-columns: 300px 1fr; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--panel); min-height: calc(100vh - 110px); overflow: hidden; }
.g-split .pl { border-right: 1px solid var(--line); overflow-y: auto; max-height: calc(100vh - 110px); }
.g-split .pl .g-tabs { padding: 0 10px; margin: 0; position: sticky; top: 0; background: var(--panel); z-index: 1; }
.g-split .pl .g-sec { margin: 12px 12px 4px; }
.g-split .pl .g-row { border-top: 0; border-left: 2px solid transparent; }
.g-split .pl .g-row.sel { border-left-color: var(--accent); box-shadow: none; }
.g-split .pr { padding: 16px 20px; overflow-y: auto; max-height: calc(100vh - 110px); }
.g-pane-subj { font-size: 16px; font-weight: 600; letter-spacing: -.01em; margin: 6px 0 4px; }
.g-kv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 12px 0; }
.g-kv span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
@media (max-width: 900px) { .g-split { grid-template-columns: 1fr; } .g-split .pl { max-height: 40vh; border-right: 0; border-bottom: 1px solid var(--line); } }
```

- [ ] **Step 2: Rewrite `renderUpdates`** to build the split: left = tabs (Open/Done with counts) + grouped rows, right = `emailPane(selected)`.

```ts
export function renderUpdates(): HTMLElement {
  const s = ui.state;
  const open = s.updates.filter((u) => u.status !== 'done');
  const done = s.updates.filter((u) => u.status === 'done');
  const list = ui.tab === 'done' ? done : open;
  if (!list.some((u) => u.key === ui.selectedKey)) ui.selectedKey = list[0]?.key ?? null;
  const groups: [string, Update[]][] = ui.tab === 'done' ? [['Done', done]] : [
    ['Needs you', open.filter((u) => u.status === 'new' && u.triage?.priority === 1)],
    ['Worth a look', open.filter((u) => u.status === 'new' && u.triage?.priority === 2)],
    ['Not read yet', open.filter((u) => u.status === 'new' && !u.triage)],
    ['Snoozed', open.filter((u) => u.status === 'snoozed')],
    ['Low priority', open.filter((u) => u.status === 'new' && u.triage?.priority === 3)],
  ];
  const left = h('div', { class: 'pl' },
    tabs([{ id: 'open', label: 'Open', count: open.length }, { id: 'done', label: 'Done', count: done.length }], ui.tab, (t) => { ui.tab = t; render(); }),
    ...groups.filter(([, xs]) => xs.length).flatMap(([title, xs]) => [sectionTitle(title, xs.length), ...paneRows(xs)]));
  const sel = list.find((u) => u.key === ui.selectedKey);
  const right = h('div', { class: 'pr' }, sel ? emailPane(sel) : emptyState(ui.tab === 'done' ? 'Nothing marked done yet.' : "You're all caught up."));
  const wrap = h('div', {});
  if (s.activity.some((a) => a.status === 'proposed')) {
    const n = s.activity.filter((a) => a.status === 'proposed').length;
    wrap.append(banner('warn', [h('strong', {}, `${n} action${n === 1 ? '' : 's'} waiting for your approval. `), 'Preview mode is on, so Pilot proposes automatic actions instead of doing them.'], [button('Review in Activity', { onClick: () => go('activity') })]));
  }
  wrap.append(h('div', { class: 'g-split' }, left, right));
  return wrap;
}

/** Similar emails collapse into one row with a count; clicking selects the newest. */
function paneRows(xs: Update[]): HTMLElement[] {
  const byKey = new Map(xs.map((u) => [u.key, u]));
  return cluster(xs.map((u) => ({ key: u.key, from: u.message.from.email, subject: u.message.subject, at: u.message.receivedAt })))
    .map((c) => {
      const u = byKey.get(c[0].key)!;
      const t = u.triage;
      return listRow({
        key: u.key,
        dot: t?.priority === 1 ? 'p1' : t?.priority === 2 ? 'p2' : 'low',
        title: [u.message.from.name || u.message.from.email, c.length > 1 ? chip(String(c.length)) : null],
        sub: u.message.subject || '(no subject)',
        right: relTime(u.message.receivedAt),
        selected: u.key === ui.selectedKey,
        onClick: () => { ui.selectedKey = u.key; render(); },
      });
    });
}
```

- [ ] **Step 3: Write `emailPane(u)`** from the existing `card(u)` body: same data and handlers, new arrangement:
  - header row: sender name (600), category `chip`, address muted, `relTime` right;
  - `div.g-pane-subj` subject; summary paragraph (muted);
  - `div.g-kv` with any of: Still waiting on you (`t.openQuestions`), You promised (`t.userPromises`), Deadline (first key date from `keyDates(u)` text), Attachment (`m.attachmentNames`), To do (`t.actionItems` joined);
  - `whyLine(u)`, `replyLine(u.reply)`, `autoLine(u)`, `proposalsFor(u)`, the conversation panel and original text exactly as now;
  - actions row (`g-acts`): Reply (primary, icon `reply`), Done (`check`), Archive (`archive`, only with permission), Snooze (`snooze`, opens `snoozeBox`), Remind me (`clock`), spacer, Open in mail (ghost, `link`), Conversation (ghost), Show original (ghost, `eye`);
  - `correctionBar(u)` restyled with ghost buttons More important (`thumbUp`), Less important (`thumbDown`), Junk (`trash`), Always from this sender… ;
  - when `editors.has(u.key)`, render `replyEditor(u)` (Task 9) right below the actions.
  Export `const card = emailPane;` so other modules keep compiling.

- [ ] **Step 4: Keyboard** in `core.ts`: change `visibleCards()` to `document.querySelectorAll<HTMLElement>('.g-split .pl .g-row[data-key]')` and `select(key)` to set `ui.selectedKey = key; render();` and scroll the row into view after render. Actions `e`/`d`/`s`/`r`/`o` keep acting on `ui.selectedKey`.

- [ ] **Step 5: Build and check** in the demo: j/k move the selection and the pane follows; Done → toast with Undo → Undo restores; groups with similar emails show a count; light and dark match mockup "Updates B".

- [ ] **Step 6: Commit** — `git commit -am "Updates with a list and reading pane"`

---

### Task 9: Inline reply composer

**Files:** Modify `src/renderer/views/updates.ts` (`replyEditor`), `src/renderer/css/components.css`

**Interfaces:** Consumes `editors`, `replyAlts`, `api.replyOptions`, `api.freeTimes`, `api.sendReply`, `accountOf`. Produces `replyEditor(u: Update): HTMLElement`.

- [ ] **Step 1: CSS**

```css
.g-composer { margin-top: 12px; border: 1px solid var(--line-strong); border-radius: var(--r-card); background: var(--panel); }
.g-composer .bar { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.g-composer .foot { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.g-composer textarea { width: 100%; border: 0; background: transparent; padding: 10px 12px; min-height: 140px; resize: vertical; outline: none; line-height: 1.55; }
.g-note { display: flex; gap: 6px; align-items: center; margin-top: 8px; font-size: 11.5px; color: var(--muted); }
```

- [ ] **Step 2: Rewrite `replyEditor`** keeping today's logic (editor text in `editors`, versions cached in `replyAlts`, signature appended, free-times insertion above the signature, Send/Save draft through `api.sendReply`):

```ts
function replyEditor(u: Update): HTMLElement {
  const to = u.message.replyTo ?? u.message.from;
  const account = accountOf(u);
  const sig = account?.permissions.signature.trim();
  const alts = replyAlts.get(u.key);
  const tone = toneOf.get(u.key) ?? 'Draft';
  const setText = (text: string) => { editors.set(u.key, text + (sig ? `\n\n${sig}` : '')); render(); };
  const pick = (t: 'Draft' | 'Brief' | 'Friendly' | 'Formal') => {
    toneOf.set(u.key, t);
    if (t === 'Draft') return setText(u.triage?.draftReply ?? '');
    if (Array.isArray(alts)) return setText(alts.find((a) => a.tone === t)?.text ?? '');
    replyAlts.set(u.key, 'loading');
    render();
    void run(async () => {
      try {
        const opts = await api.replyOptions(u.key);
        replyAlts.set(u.key, opts);
        setText(opts.find((a) => a.tone === t)?.text ?? '');
      } catch (e) {
        replyAlts.delete(u.key);
        toneOf.set(u.key, 'Draft');
        throw e;
      } finally { render(); }
    });
  };
  const ta = h('textarea', { id: `reply-${u.key}`, value: editors.get(u.key) ?? '', oninput: (e: Event) => editors.set(u.key, valueOf(e)), 'aria-label': 'Reply text' });
  const finish = (send: boolean) => void run(async () => { await api.sendReply(u.key, editors.get(u.key) ?? '', send); editors.delete(u.key); render(); }, send ? 'Reply sent' : 'Draft saved to your mailbox');
  return h('div', { class: 'g-composer' },
    h('div', { class: 'bar' }, h('span', { class: 'muted small' }, `Reply to ${to.name ? `${to.name} <${to.email}>` : to.email}`), h('span', { style: 'flex:1' }),
      alts === 'loading' ? h('span', { class: 'muted small' }, 'Writing versions…') : null,
      segmented([{ value: 'Draft', label: 'Draft' }, { value: 'Brief', label: 'Brief' }, { value: 'Friendly', label: 'Friendly' }, { value: 'Formal', label: 'Formal' }], tone, pick)),
    ta,
    h('div', { class: 'foot' },
      button('Send', { kind: 'primary', icon: 'send', onClick: () => finish(true) }),
      button('Save as draft', { onClick: () => finish(false) }),
      account?.calendar ? button('Insert my free times', { kind: 'ghost', icon: 'calendar', onClick: () => insertTimes(u, sig) }) : null,
      h('span', { style: 'flex:1' }),
      button('Cancel', { kind: 'ghost', onClick: () => { editors.delete(u.key); render(); } })),
  );
}
const toneOf = new Map<string, 'Draft' | 'Brief' | 'Friendly' | 'Formal'>();
```

Move the existing free-times code into `insertTimes(u, sig)` unchanged. Below the composer keep the safety line as `h('div', { class: 'g-note' }, icon('shield', 13), 'Pilot never agrees to meetings or payments for you.')`.

- [ ] **Step 3: Check in the demo**: open Reply, switch to Friendly (versions load once), switch back to Draft, Cancel; light/dark match mockup "Reply A".

- [ ] **Step 4: Commit** — `git commit -am "Inline reply composer with version switch"`

---

### Task 10: Deadlines weekly list

**Files:** Modify `src/renderer/views/deadlines.ts`

- [ ] **Step 1: Rewrite `renderDeadlines`** with the same data (`ui.state.items`, `deadlineKind`, `showEvidence`, `api.setItem`, `openRemind`):
  - `tabs` for All / Bills / Deadlines / Appointments / Events / Deliveries (values `'all' | KeyItemKind`), right side: `h('span', { class: 'muted small num' }, \`${total} due in the next 2 weeks\`)` from `ui.state.weekly`;
  - group open items into Past due (`at < startOfToday`), This week (before next Monday), Next week, Later, No date; each group: `sectionTitle(name, n)` + `table` with columns `[{label:'Date'}, {label:'What'}, {label:'Amount', align:'right'}, {label:'', align:'right'}]`;
  - cells: date (`Mon, Oct 26` + time if not all-day, muted), title cell = kind icon (`bill`/`calendar`/`clock`/`mail`) + bold title + muted source sender and, when `notes.length`, `chip('Check', 'warn')`; amount in `.num`; actions = `button('Done', { tiny: true, icon: 'check' })`, `button('Remind me', { tiny: true, kind: 'ghost' })`, `button('Dismiss', { tiny: true, kind: 'ghost' })`;
  - clicking the title toggles `showEvidence` and renders the quote and notes in a following full-width row (`<tr><td colspan="4">`);
  - Done tab equivalent: a small "Show done" ghost button at the bottom listing done/dismissed items in a muted table.
- [ ] **Step 2: Check** with demo data (bill $35, contract deadline, session) in light/dark against "Deadlines A".
- [ ] **Step 3: Commit** — `git commit -am "Deadlines as a weekly list"`

---

### Task 11: Follow-ups in two columns

**Files:** Modify `src/renderer/views/followups.ts`

- [ ] **Step 1: Rewrite `renderFollowUps`** using existing data and handlers (`state.followUps`, `state.owed`, `state.commitments`, `state.reminders`, `api.setFollowUp`, `api.nudge`/draft-nudge call used today, `openRemind`, `remindBox`):
  - `h('div', { class: 'g-grid2 eq' }, left, right)`;
  - left: `sectionTitle('Waiting on them', n)` + `g-list` of `listRow({ dot: 'low', title: recipient, sub: \`${subject} · sent ${date}\`, right: age chip warn when due })`; under each selected/overdue row show actions Draft a nudge (`pen`), Remind me (`clock`), Mark done (`check`), Not needed (ghost);
  - right: `sectionTitle('You owe', n)` (owed replies, click opens the email in Updates via `ui.selectedKey` + `go('updates')`), `sectionTitle('You promised', n)` (commitments with Done/Dismiss), `sectionTitle('Reminders', n)` (pending reminders with Cancel);
  - empty states per list ("Nobody owes you a reply.", etc.).
- [ ] **Step 2: Check** against "Follow-ups A", light/dark.
- [ ] **Step 3: Commit** — `git commit -am "Follow-ups in two columns"`

---

### Task 12: Ask as a conversation

**Files:** Modify `src/renderer/views/ask.ts`, `src/renderer/css/components.css`

- [ ] **Step 1: CSS**

```css
.g-chat { display: grid; grid-template-columns: 1fr 240px; gap: 16px; min-height: calc(100vh - 110px); }
.g-thread { display: flex; flex-direction: column; gap: 10px; }
.g-msg { max-width: 78%; padding: 9px 12px; border-radius: var(--r-card); }
.g-msg.me { align-self: flex-end; background: var(--nav-on); }
.g-msg.ai { border: 1px solid var(--line); background: var(--panel); }
.g-cite { font-size: 10px; color: var(--accent-text); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 4px; margin-left: 2px; cursor: pointer; background: none; }
.g-askbar { position: sticky; bottom: 0; margin-top: auto; display: flex; gap: 8px; align-items: center; border: 1px solid var(--line-strong); border-radius: 7px; padding: 8px 10px; background: var(--panel); }
.g-askbar input { flex: 1; border: 0; background: transparent; outline: none; font-size: 13px; }
.g-srcs { border-left: 1px solid var(--line); padding-left: 14px; }
.g-src { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; cursor: pointer; }
.g-cnum { width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--line-strong); font-size: 10.5px; display: grid; place-items: center; color: var(--accent-text); flex: none; }
mark { background: var(--accent-weak); color: var(--text); border-radius: 2px; padding: 0 2px; }
```

- [ ] **Step 2: Rewrite `renderAsk`**: keep the instant search (`api.search` with `askTimer`) and `api.ask`. Add a session-only `thread: { q: string; a?: AskResult; error?: string }[]`. Layout:
  - `.g-chat` → left `.g-thread`: each turn renders `g-msg me` (question) and `g-msg ai` (answer text with citation numbers turned into `button.g-cite` that open the source email; while waiting, `skeleton(2)`; on error, `banner('danger', ...)`); when typing and no answer yet, the instant results list (`renderAskResultsList` restyled as `g-list` rows with highlighted terms) appears above the bar;
  - `.g-askbar`: `icon('search')`, input (autofocus, Enter submits), `g-kbd` Enter;
  - right `.g-srcs`: `sectionTitle('Sources', n)` and `g-src` rows numbered across the whole thread; clicking one sets `ui.selectedKey` and `go('updates')`;
  - semantic search status line (from `ui.state.search`) muted under the bar.
- [ ] **Step 3: Check**: ask two questions in the demo; citations open emails; light/dark against "Ask B".
- [ ] **Step 4: Commit** — `git commit -am "Ask as a conversation with sources"`

---

### Task 13: Mailbox cards

**Files:** Modify `src/renderer/views/mailboxes.ts`, `src/renderer/views/onboarding.ts` (`renderAddMailbox` restyle only)

- [ ] **Step 1: Rewrite `renderMailboxes`** with existing handlers (`api.updateAccount`, `api.removeAccount`, `api.connect`, permissions object):
  - header action `button('Add mailbox', { kind: 'primary', icon: 'plus' })` (opens the add flow, as now);
  - per account a `card` with a head row: avatar square (first letter, `--nav-on` background), address (600), meta line `${providerName} · ${access === 'readonly' ? 'read-only' : 'full access'}${calendar ? ' · calendar connected' : ''} · checked ${relTime(lastSyncAt)}`, status `chip(watching ? 'Watching' : 'Paused', watching ? 'ok' : 'neutral')`, `button(watching ? 'Pause' : 'Start watching')`;
  - banners inside the card for needsReconnect (warn), read-only (info) and calendar (info, Connect/Disconnect calendar);
  - permission rows: label + hint on the left, `toggle(...)` on the right, for: Read new mail (watching), Alert me about important mail, Archive when I ask, Label with categories, Clean up automatically (with its category checkboxes kept as today), Unsubscribe mode as `segmented` (Off / Suggest / Automatic), Replies as `segmented` (Suggest only / Save drafts / Auto-send to trusted), trusted senders and signature fields (`field`);
  - footer: Remove mailbox (`danger` ghost, keeps today's confirm);
  - dashed "Add a mailbox" row at the end (`.g-empty` style, clickable).
  Read-only accounts keep write toggles disabled exactly as today.
- [ ] **Step 2: Restyle `renderAddMailbox`** steps with `field`, `button`, `banner` (no logic change).
- [ ] **Step 3: Check** against "Mailboxes A", light/dark; toggles still save (watch the toast).
- [ ] **Step 4: Commit** — `git commit -am "Mailbox cards with plain-language switches"`

---

### Task 14: Rules table

**Files:** Modify `src/renderer/views/rules.ts`

- [ ] **Step 1: Rewrite `renderSorting`** keeping `plainRuleBox`, rule saving and suggestion handlers:
  - `tabs([{id:'rules', label:'Rules', count}, {id:'suggested', label:'Suggested', count}], rulesTab, ...)` with right-side `button('New rule', { kind: 'primary', icon: 'plus' })` that toggles `showNewRule`;
  - when `showNewRule`: `plainRuleBox()` restyled as a `card` (input + Preview, preview block, Create rule / Cancel) and, under a ghost "Or add by address" disclosure, the existing address + effect form;
  - Rules tab: `table` columns When / Then / Source / Used (right) / On (right) / '' — When = sender, `@domain` or `anyone`, plus `subject contains "x"` muted; Then = `chip('Important','danger') | chip('Low priority') | chip('Hide')`; Source = Added by you / From a correction / From a suggestion; Used = hits (+ last used title attr); On = `toggle`; last cell a `select` (Always important / Always low priority / Hide) and a ghost Delete;
  - Suggested tab: rows with the suggestion sentence, the `because` text muted, Create rule (primary tiny) and Not now (ghost tiny);
  - empty states.
- [ ] **Step 2: Check** against "Rules B"; create and delete a rule in the demo.
- [ ] **Step 3: Commit** — `git commit -am "Rules as a table"`

---

### Task 15: Activity timeline

**Files:** Modify `src/renderer/views/activity.ts`, `src/renderer/css/components.css`

- [ ] **Step 1: CSS**

```css
.g-tl { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-card); }
.g-tli { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line); }
.g-tli:first-child { border-top: 0; }
.g-tdot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); flex: none; }
.g-tdot.warn { background: var(--warn); } .g-tdot.ok { background: var(--ok); } .g-tdot.danger { background: var(--danger); }
.g-tli .body { flex: 1; min-width: 0; }
.g-tli pre { white-space: pre-wrap; background: var(--side); border: 1px solid var(--line); border-radius: var(--r-ctl); padding: 8px 10px; margin: 6px 0 0; font: 12px/1.5 var(--font); }
```

- [ ] **Step 2: Rewrite `renderActivity` and `activityRow`** with the same data and handlers (`activityFilter`, `api.approve`, `api.reject`, `api.undo`, `api.approveAll`, `ACTION_LABEL`, `IRREVERSIBLE`, statusLabel logic): `tabs` Waiting for you (count) / Everything, right side `button('Approve all (no sends)')` when waiting; each entry a `.g-tli` with dot tone (proposed → warn, done → ok, failed → danger, else default), body = bold action label (+ category) · subject · sender, meta line (relTime · Automatic/You · reason · mailbox), error in danger color, reply text `pre`, irreversible note; buttons on the right as today.
- [ ] **Step 3: Check** against "Activity A": approve, reject and undo in the demo.
- [ ] **Step 4: Commit** — `git commit -am "Activity as a timeline"`

---

### Task 16: Settings with a sub-menu, and Appearance

**Files:** Modify `src/renderer/views/settings.ts`, `src/renderer/css/components.css`

- [ ] **Step 1: CSS**

```css
.g-settings { display: grid; grid-template-columns: 170px 1fr; gap: 24px; align-items: start; }
.g-subnav { display: flex; flex-direction: column; gap: 1px; position: sticky; top: 0; }
.g-subnav button { text-align: left; border: 0; background: none; padding: 6px 10px; border-radius: var(--r-ctl); color: var(--muted); cursor: pointer; }
.g-subnav button.on { background: var(--nav-on); color: var(--text); font-weight: 500; }
.g-setbody { max-width: 560px; }
.g-setrow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
.g-setrow:first-child { border-top: 0; }
.g-setrow > div { flex: 1; } .g-setrow b { display: block; font-weight: 500; } .g-setrow span { font-size: 11.5px; color: var(--muted); }
```

- [ ] **Step 2: Rewrite `renderSettings`** into sections chosen by a module-level `settingsSection: 'general' | 'ai' | 'briefing' | 'automation' | 'privacy' | 'updates'`:
  - General: name (`field`), Appearance `segmented([{value:'light',label:'Light'},{value:'dark',label:'Dark'},{value:'system',label:'Match Windows'}], s.appearance, (v) => void run(() => api.saveSettings({ appearance: v })))` (saves immediately), check interval, lookback, follow-up days, Start with Windows toggle;
  - AI model: Ollama address, model, fast model, Test connection, the AI setup panel (`aiSetupPanel()`), semantic search download, "How your mail was read" stats table restyled with `table`;
  - Briefing: enabled, time, days, sections;
  - Automation: preview mode toggle;
  - Privacy: encryption toggle, data folder button;
  - Updates: check toggle, feed field, Check now, last result.
  Every field and its save handler is the existing one; each section ends with its own Save button where the old form had one (Appearance and toggles save immediately as today).
- [ ] **Step 3: Check** against "Settings A"; switching Appearance flips the whole app instantly and survives restart; Match Windows follows the OS.
- [ ] **Step 4: Commit** — `git commit -am "Settings with a sub-menu and Appearance"`

---

### Task 17: First run (split welcome), Subscriptions, Replies, Notifications

**Files:** Modify `src/renderer/views/onboarding.ts`, `views/aisetup.ts`, `views/subscriptions.ts`, `views/replies.ts`, `views/notifications.ts`, `src/renderer/css/components.css`

- [ ] **Step 1: CSS**

```css
.g-welcome { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
.g-welcome .l { background: var(--side); border-right: 1px solid var(--line); padding: 48px 48px; }
.g-welcome .l h1 { font-size: 26px; letter-spacing: -.025em; line-height: 1.2; margin: 40px 0 10px; max-width: 18ch; }
.g-welcome .l p { color: var(--muted); max-width: 40ch; font-size: 13.5px; }
.g-welcome .l ul { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 10px; }
.g-welcome .l li { display: flex; gap: 10px; align-items: center; } .g-welcome .l li svg { color: var(--accent-text); }
.g-welcome .r { padding: 48px; max-width: 560px; }
.g-step-k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--accent-text); font-weight: 600; margin-bottom: 10px; }
.g-check { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); align-items: flex-start; }
.g-check > div { flex: 1; } .g-check b { display: block; font-weight: 500; } .g-check span { font-size: 11.5px; color: var(--muted); }
.g-check.done svg { color: var(--ok); } .g-check.on svg { color: var(--accent-text); } .g-check.todo { color: var(--muted); }
@media (max-width: 900px) { .g-welcome { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Rewrite `renderOnboarding`** as `.g-welcome`: left column = brand (mark + "Inbox Pilot"), headline "Your email, read on your own PC.", one sentence ("Pilot sorts what matters, tracks bills and deadlines, and drafts replies you approve. Nothing is sent to an AI company."), three `li` with icons `shield` "Encrypted on this PC", `check` "Never sends without your OK", `undo` "Archive can be undone". Right column = `g-step-k` "Step N of 3", then a three-item checklist (Your name, AI on this PC, Your mailbox) using `.g-check` with states done/on/todo, and the current step's content below (name form; `aiSetupPanel(next)`; `renderAddMailbox(...)`), with Back / Skip for now ghost buttons. Keep the Enter-key blur fix from the name step.
- [ ] **Step 3: Restyle `aiSetupPanel`** with `card`, `progress(percent)`, `button`, `banner` (same states and calls).
- [ ] **Step 4: Restyle Subscriptions** (cleanup `card` above a `table` of senders: Sender / Emails (right) / Last / '' with Unsubscribe and Archive all as today), **Replies** (Settings-style `.g-settings`-like sections: Which emails get replies, Safeguards, Voice with `styleBlock()`), **Notifications** (each channel a `card` with `toggle`, level `segmented`, event toggles, test button; quiet hours and limits as `.g-setrow`s). No logic changes.
- [ ] **Step 5: Check** first run on a fresh profile (`--profile=` harness) and the three pages in light/dark.
- [ ] **Step 6: Commit** — `git commit -am "Split welcome first run; Subscriptions, Replies and Notifications in Graphite"`

---

### Task 18: Remove legacy CSS, full visual QA, release

**Files:** Delete `src/renderer/styles.css`; modify `src/renderer/index.html`, `scripts/copy-static.mjs`, docs (`README.md`, `docs/STATUS.md`, `docs/AUDIT_AND_PLAN.md`), `package.json` (version 0.14.0)

- [ ] **Step 1: Find leftovers** — run `grep -rhoE "class: ['\`][^'\`]+" src/renderer | sort | uniq -c | sort -rn` and confirm every class used is defined in `css/*.css` (old names such as `banner`, `btn`, `card`, `group`, `tabs` must be gone). Fix any screen still using an old class.

- [ ] **Step 2: Delete legacy CSS** — remove `src/renderer/styles.css`, its `<link>` in `index.html` and `'styles.css'` from `copy-static.mjs`; delete the legacy variable aliases (`--chip --p1 --p2 --p3 --accent-text-legacy`) from `tokens.css`.

- [ ] **Step 3: Visual QA in demo mode** — `npm run build`, then run the screenshot harness (`npx electron <scratchpad>/shot3.cjs` with `SHOT_MODE=demo`) over a steps file that visits every nav item, in light, then sets `document.documentElement.dataset.theme='dark'` and visits them again, saving `qa-<view>-<theme>.png`. Also exercise: j/k, Done then Undo, `?` overlay, Reply → Friendly, rule preview, theme button. Compare each screenshot with the mockup; fix differences. Then the fresh-profile first-run steps.

- [ ] **Step 4: Tests** — `npm test` (expected 225 pass, including the emoji scan) and `npm run typecheck`.

- [ ] **Step 5: Docs** — README "How it works" gains a short "Look and feel" paragraph (Graphite, light/dark toggle in the sidebar and Settings → Appearance); STATUS and AUDIT_AND_PLAN get a 0.14.0 entry listing what was verified.

- [ ] **Step 6: Release** — bump `package.json` to `0.14.0`, `npm run dist`, stop the running app, install silently (`"release/Inbox Pilot Setup 0.14.0.exe" /S`), start it, and confirm from the log: `app.start` 0.14.0, `sync.done`, no errors.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "Graphite redesign complete: legacy styles removed, version 0.14.0"
git push
```
