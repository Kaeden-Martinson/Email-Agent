# Graphite redesign: design

Date: 2026-10-25. Status: approved in brainstorming; awaiting spec review.
Mockups: `docs/superpowers/specs/mockups/graphite-screens.html` (open in a browser; the top switch toggles light/dark) and `visual-directions.html` (the three directions; Graphite was chosen).

## Goal

Rebuild Inbox Pilot's interface in the "Graphite" look: sleek, professional, information-dense, with a light/dark toggle, SVG icons only and no emoji. Every current feature keeps working; only how it looks and where it sits changes.

## Non-goals

- No change to mail reading, triage, safety rules, permissions, storage or any IPC behavior.
- No new features. (Screens without a mockup are restyled with the same parts, not redesigned from scratch.)
- No framework or build tool. The renderer stays plain TypeScript with the `h()` helper, compiled by `tsc`, loaded as ES modules.

## 1. Visual system

**Color tokens** (CSS custom properties on `:root`, dark values under `:root[data-theme="dark"]`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fbfbfc` | `#0e0f12` | window background |
| `--side` | `#f4f5f7` | `#121418` | sidebar, table headers, sub-panels |
| `--panel` | `#ffffff` | `#16181d` | cards, lists, inputs |
| `--text` | `#111318` | `#e9ebf0` | body text |
| `--muted` | `#6b7180` | `#8a909c` | secondary text, icons |
| `--line` | `#e7e9ee` | `#23262d` | hairline borders, row dividers |
| `--line-strong` | `#d5d9e1` | `#30343c` | control borders |
| `--nav-on` | `#e8ebf1` | `#1e2128` | selected nav item, selected segment |
| `--accent` | `#2b59d9` | `#5b84f2` | primary buttons, focus, selection |
| `--accent-weak` | `#e9effc` | `#1a2440` | selected row, highlights |
| `--accent-text` | `#2b59d9` | `#86a5f7` | accent-colored text |
| `--on-accent` | `#ffffff` | `#0b1020` | text on accent |
| `--danger` / `--p1` | `#d43c3c` | `#f06a6a` | "needs you", errors, destructive |
| `--ok` | `#1f9d63` | `#3ccf8e` | success, watching |
| `--warn` | `#b7791f` | `#e3a64a` | waiting, overdue, pending approval |

One accent only. Priority is shown by a 6px dot (red = needs you, accent = worth a look, `--line-strong` = low).

**Type:** Inter 400/500/600, bundled as local `woff2` files in `src/renderer/fonts/` (SIL Open Font License, license file included). Fallback `"Segoe UI", system-ui`. Scale (px): 10.5 (section labels, uppercase +0.07em), 11.5 (meta), 12.5 (body, rows), 13.5 (emphasis), 16 (pane titles), 18 (page titles, -0.02em). Numbers use `font-variant-numeric: tabular-nums`.

**Shape and spacing:** 1px hairline borders, no drop shadows (the only exception is the keyboard-shortcuts overlay). Radius 5px on controls (buttons, inputs, segments), 6px on panels, 8px on the window-level frame. Spacing steps 4 / 6 / 8 / 10 / 12 / 14 / 18 / 22 px.

**Motion:** 150 ms color/background transitions on theme switch and hover; no decorative animation. Progress bars for downloads; a skeleton row while a list first loads.

## 2. Theme

- Setting `appearance: 'light' | 'dark' | 'system'` (default `system`) in `Settings`, merged like other settings (older saves get the default).
- The renderer sets `document.documentElement.dataset.theme` to `light` or `dark`; for `system` it follows `prefers-color-scheme` and listens for changes.
- Sidebar footer has a theme button (sun/moon icon) that flips light ↔ dark and saves the choice. Settings → General → Appearance offers Light / Dark / Match Windows as a segmented control.
- Main process: `BrowserWindow` `backgroundColor` and Electron `nativeTheme.themeSource` follow the saved appearance at startup and when it changes, so there is no white flash and native scrollbars/menus match.

## 3. Icons

- `src/renderer/icons.ts` exports an `icon(name, size?)` function returning an inline `<svg>` built with `createElementNS`, plus an `IconName` union type. One stroke style: 24×24 view box, 1.6 stroke, round caps/joins, `currentColor`.
- Set (about 35): home, inbox, search, calendar, reply, mail, list, gear, rules, bell, news, pen, send, bill, clock, pilot (logo), archive, check, snooze, chevron (up/down/right), x, plus, undo, shield, cpu, download, file, link, filter, more, spark, sun, moon, alert, refresh, eye.
- Every emoji or text glyph used as an icon is removed. A test greps the renderer sources and fails on any emoji code point.

## 4. Layout shell

- Two-column grid: 188px sidebar + content. Sidebar: logo mark and name, nav items (icon, label, right-aligned count in tabular figures), and a footer with the watching status dot and the theme button.
- Page header: title (18px) on the left, page actions on the right (for example Check now).
- Notices (update available, reconnect, AI setup, errors) render as one banner style under the header: hairline border, a left accent bar colored by kind, text and actions.

## 5. Screens (chosen layouts)

| Screen | Layout | Notes |
|---|---|---|
| Today | Two columns | Left: Needs you list, then Your week as a 4-figure stat row. Right: Coming up agenda (dates, icons, amounts) and Waiting on. Briefing text sits above both columns when today's briefing exists. AI setup panel and reconnect banners stay on top. |
| Updates | Reading pane | Left (≈300px): Open/Done tabs, grouped list (Needs you, Worth a look, Not read yet, Snoozed, Low priority) with similar-email groups shown as one row with a count. Right: selected email in full: header, subject, summary, key facts grid (still waiting on you, you promised, deadline, attachment), why line, actions (Reply, Done, Archive, Snooze…, More/Less important, Junk, Always from this sender…, Show original, Conversation). `j`/`k` move the selection; the pane keeps its scroll position per email. With nothing selected, the first email is selected. |
| Reply | Inline composer | Opens inside the reading pane under the email. Top bar: recipient and a Brief / Friendly / Formal segmented control (asks the AI on first use, then switches instantly). Body textarea with signature. Footer: Send (primary), Save as draft, Insert my free times (when calendar is connected), Cancel. The safety note line stays. |
| Deadlines | Weekly list | Filter tabs (All, Bills, Deadlines, Events, Appointments, Deliveries) plus the 2-week total on the right; groups This week / Next week / Later / Past due; rows: date column, icon + title + source, amount column, actions (Done, Dismiss, Remind me). Evidence expands under a row. |
| Follow-ups | Two columns | Left: Waiting on them (age colored warn when overdue) with Draft a nudge / Remind me. Right: You owe, then You promised, then Reminders. |
| Ask | Conversation | Thread of questions and cited answers (citation chips), input at the bottom with Enter to send; instant search results appear above the input while typing. Right column: sources for the whole conversation; clicking one opens the email in Updates. Conversation is kept for the session only. |
| Mailboxes | Mailbox cards | One card per mailbox: avatar letter, address, provider · access · calendar · last check, Watching/Paused status and button; plain-language switches; replies as a segmented control; trusted senders, signature and calendar connect in the same card. Add mailbox as a dashed row and a header button. |
| Rules | Table | Tabs Rules / Suggested. Columns: When (sender, domain, subject words), Then (status chip), Source, Used, On (switch), row menu (edit effect, delete). New rule opens the Describe a rule box with preview above the table; Add by address stays as a secondary option in that box. Suggested tab rows have Create and Not now. |
| Activity | Timeline | Tabs Waiting for you / Everything; Approve all (never includes sends). Each item: status dot (warn waiting, ok done, muted other), action and email, meta line, inline buttons (Approve, Approve and send, Reject, Undo), errors in danger color. |
| Settings | Sub-menu | Sections: General (name, appearance, check interval, start with Windows), AI model, Briefing, Automation (preview mode), Privacy, Updates. Notifications stays its own nav page. One section visible at a time; Save per section. |
| First run | Split welcome | Left: logo, one-line promise, three assurances with icons. Right: step label and checklist (name, AI setup with progress, add mailbox). Same AI setup panel component is reused on Today. |

Screens without a mockup use the same parts: Subscriptions (bulk cleanup card above a table of senders), Replies (Settings-style sections), Notifications (Settings-style sections with per-channel cards).

## 6. Components

Shared builders in `src/renderer/ui.ts`, each a function returning an element: `button(label, {kind, icon})`, `segmented(options, value, onChange)`, `toggle(checked, onChange)`, `tabs(items, active)`, `card(...)`, `listRow(...)`, `table(columns, rows)`, `stat(...)`, `chip(text, tone)`, `banner(kind, ...)`, `emptyState(text, action?)`, `field(label, input, hint?)`, `progress(percent?)`. Screens compose these instead of hand-writing class strings.

## 7. Code structure

- `src/renderer/core.ts`: state, `h()`, `render()`, `run()`, `toast()`, navigation, keyboard handling (moved from `renderer.ts`, behavior unchanged).
- `src/renderer/icons.ts`, `src/renderer/ui.ts`, `src/renderer/theme.ts`.
- `src/renderer/views/*.ts`: one file per screen (today, updates, ask, deadlines, followups, mailboxes, subscriptions, activity, rules, replies, notifications, settings, onboarding).
- `src/renderer/renderer.ts` becomes the entry point that wires views into the shell.
- CSS: `styles.css` replaced by `tokens.css` (colors, type, spacing), `base.css` (reset, shell, typography) and `components.css`; `copy-static.mjs` copies all three plus `fonts/`. The CSP in `index.html` already allows `'self'` fonts and styles.

## 8. Error handling and empty states

- Every list has an empty state (one sentence, optional action), a loading skeleton on first load, and errors shown in a banner with the existing friendly messages.
- Theme falls back to light if the saved value is unknown.

## 9. Testing

- Existing unit tests (220) keep passing; renderer logic that moves stays covered by the existing tests where it was.
- New tests: theme resolution (`light`/`dark`/`system` with a mocked media query), icon set completeness (every `IconName` has a path), and a source scan that fails on emoji code points in `src/renderer`.
- Visual check in demo mode with the screenshot harness: every screen in light and dark, compared against the mockups; keyboard shortcuts (`j`/`k`, `e`, `d`, `s`, `r`, `?`, `Ctrl+K`), undo toast, reply versions and AI setup panel exercised.
- Then build, install over the current version, and confirm from the log that it starts, syncs and shows no errors.

## Open decisions (resolved)

- Look: Graphite (B). Layouts as in section 5. Theme: toggle in sidebar + Appearance setting, default Match Windows. Font: Inter, bundled.
