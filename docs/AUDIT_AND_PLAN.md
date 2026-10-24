# Pilot: audit and implementation plan

*Written 2026-10-23 against the code in this repository, using measurements from the first real Gmail sync (28 emails).*

## 1. Audit

### What the app actually is

| Layer | Reality |
|---|---|
| Shell | Electron 45, TypeScript, plain-DOM renderer (no framework), tray app |
| Storage | One JSON file `%APPDATA%\inbox-pilot\state.json`, rewritten whole on every change (300 ms debounce). There are no migrations: `version: 1` exists but nothing reads it. |
| Secrets | `tokens.bin`, holding OAuth tokens and IMAP passwords, encrypted with Electron `safeStorage` (DPAPI) |
| Providers | Gmail REST, Microsoft Graph, IMAP/SMTP (imapflow + nodemailer), all behind the `MailProvider` interface |
| AI | Local Ollama, one structured-JSON call per email (`ai/triage.ts`), `num_ctx` 8192, body cut to 6000 chars |
| Automation | `engine.ts`: per-mailbox permissions, then label → auto-reply → auto-archive → auto-unsubscribe, with hard blockers in code |

### How an email flows today

`Engine.sync()` → for each watched mailbox `provider.fetchSince()` (Gmail fetches messages **one at a time**) → new `Update` stored → `triagePending()` runs, **sequentially, one full LLM call per email, newest first** → `autopilot()` (label / reply / archive / unsubscribe) → `changed()` → the entire state is pushed to the renderer.

### Feature status

| Roadmap item | Status |
|---|---|
| 1 Learning from corrections | **Missing.** The only fix today is "Re-read", which re-runs the same model. |
| 2 Fast pipeline | **Missing.** Every email gets the full model. Measured: 15 of 21 triaged emails were bulk mail that rules could classify without the model. |
| 3 Activity log / undo | **Partial.** `Update.reply` and `Update.auto` record the last action per email, but there's no global log and no undo. Dry-run doesn't exist. |
| 4 Thread understanding | **Missing.** Only the newest message is read, and quoted history is fed to the model as if it were new text. |
| 5 Follow-ups | **Missing.** |
| 6 Bills / deadlines | **Partial.** `actionItems` captures deadlines as free text, with no structure, dates or reminders. |
| 7 Ask my inbox | **Missing.** There's no search at all. |
| 8 Phone notifications / briefing | **Partial.** A local morning briefing and Windows notifications exist; there's no phone channel, no quiet hours and no content controls. |
| 9 Windows installer | **Missing.** The app only runs via `npm start`. |
| 10 Outlook | **Implemented but unverified.** `providers/outlook.ts` exists; it's blocked on an Azure app registration. |
| 11 Production readiness | **Partial.** Testing-mode Google client; scope `gmail.modify` (restricted). |
| 12 Engineering quality | **Missing.** No git, no tests, no structured logs. |

### Bugs, risks and bottlenecks found

1. **Speed.** About 40 s per email; a 28-email first sync takes about 20 minutes. Most of that time goes to bulk mail.
2. **Gmail N+1 fetch.** 28 sequential HTTP calls per sync.
3. **Full-state push.** Every change sends all updates, with bodies up to 4000 chars, to the renderer, and rewrites the entire JSON file.
4. **Classification drift.** The model under-uses newsletter and promo, so I patched it with a blunt rule ("bulk + fyi → newsletter"). That rule wrongly buried a Tennessee Tech admissions email.
5. **No explanation.** The user can't see *why* an email got its priority.
6. **Automation can't be previewed.** Turning on auto-archive or auto-send acts immediately; there's no preview and no undo.
7. **Email bodies are stored unencrypted** in `state.json` (tokens are encrypted). That's acceptable for a local app, but it should be disclosed and optionally encrypted.
8. **`Update.auto` is reset on every re-read**, so action history is lost.
9. **Safety logic is untested.** The never-reply rules, trusted senders and daily cap live inside `Engine` and can't be unit-tested without Electron.

### Must not regress

- Per-mailbox permissions, with every automation off by default.
- The hard reply blockers: bulk mail, no-reply senders, self, already-replied threads, and the never-reply categories.
- Auto-send only to trusted senders, under the daily cap.
- Auto-unsubscribe only through RFC 8058 one-click.
- Email content is passed to the model as untrusted data, and the model's output is constrained to a JSON schema.
- Onboarding, email-first discovery, Cancel sign-in, demo mode.

## 2. Plan, ranked

| # | Stage | Value | Effort | Depends on |
|---|---|---|---|---|
| 1 | **Git + test harness**: extract pure, Electron-free modules (`policy`, `rules`, `prefilter`) and add safety tests | High (safety net) | S | none |
| 2 | **Multi-stage pipeline**: rules → deterministic prefilter → light AI → full AI; personal and unread mail first; Gmail fetch concurrency; per-email timing and source metrics | Very high (≈3–5× faster) | M | 1 |
| 3a | **Learned rules + corrections**: card controls, sender and domain rules that override the AI, a Rules page, suggested rules after repeated corrections, accuracy tracking | Very high | M | 1, 2 |
| 3b | **Activity log, preview (dry-run) mode, undo**: persistent log with status, reason and source; approve proposed actions; undo archive and label | High (trust) | M | 1 |
| 4 | Thread understanding: fetch the thread, strip quoted text, thread-aware drafts, source inspection | High | M | 2 |
| 5 | Follow-ups and commitments: "waiting on", "you owe a reply", natural-language reminders | High | M | 4 |
| 6 | Structured deadlines and bills, with a command-center screen | High | M | 2, 5 |
| 7 | Ask my inbox: local keyword index first, then local embeddings | High | M–L | 4 |
| 8 | Phone notifications (ntfy) with quiet hours and content-level control | Medium | S | 3b |
| 9 | Installer (electron-builder NSIS), launch at login, auto-update | Medium (High for distribution) | M | none |
| 10 | Outlook verification | Medium | S | Azure signup (yours) |
| 11 | Production readiness docs | Medium | S–M | 9 |

**This session delivers stages 1, 2, 3a and 3b.** Stages 4–11 stay queued in this order.

### Acceptance criteria for this session

- **Stage 1:** `git log` shows a baseline commit. `npm test` runs and passes. Every hard safety rule has a test.
- **Stage 2:** Obvious bulk mail is classified with no model call. Bulk mail with account, money or school keywords still goes to the model. Each triage records its source and milliseconds. Settings shows how many emails went through each path. Unread and personal mail is processed first.
- **Stage 3a:** Each card has *More important*, *Less important* and *Junk*, plus *Always from this sender…*. Rules override the AI and re-apply to existing mail. The Rules page can list, toggle, edit and delete rules. A single correction never creates a rule on its own; after two same-direction corrections, the Pilot *suggests* one. Corrections are counted per pipeline stage.
- **Stage 3b:** Every automatic or user action goes into a log with its time, mailbox, email, reason, source and status. Preview mode, on by default, turns automatic actions into *proposed* items you approve. Archive and label can be undone. Actions that can't be undone (send, unsubscribe, draft) say so. A failure is logged as failed, never as done.

## 3. Progress log

**2026-10-23: stages 1, 2, 3a and 3b delivered**

- **Stage 1:** git baseline (`b6f35dd`); `npm test` with 57 tests passing; safety logic extracted to `src/main/core/policy.ts`.
- **Stage 2:** `core/prefilter.ts` + `classify()` in `engine.ts`; rule-decided mail first, then unread personal mail; Gmail fetches 5 at a time; per-email source and time recorded; the stats table is in Settings. Measured on the real inbox: 18 of 28 emails decided instantly, 0 important emails fast-pathed. The light read was **not** meaningfully faster than the full read on short emails (about 10 s each with gemma4:e4b); the speed-up comes from skipping the model.
- **Stage 3a:** correction bar, sender and domain rules (no domain rules for public webmail), Rules page, suggestions after two same-direction corrections, corrections counted per stage.
- **Stage 3b:** activity log for every action, preview mode on by default, approve/reject on the email and in Activity, undo for archive and label (Gmail; Outlook and IMAP return new ids, so restores dedupe by Message-ID).
- **Verified in the running app (demo mode):** proposals → approve → done → undo; corrections; rule creation; stats. **Not yet verified against live Gmail:** label/archive undo on a real message, because no autopilot action has been enabled on your mailbox.

**Next:** stage 4 (thread understanding), then 5 (follow-ups), 6 (deadlines and command center), 7 (ask my inbox).

**2026-10-24: stage 4 delivered (thread understanding)**

- `core/thread.ts`: quote stripping (Gmail "On … wrote:", including the two-line form; Outlook From/Sent blocks; "Original Message"; `>` lines; forwards kept), `buildThread` (oldest first, ends at the current message, last 8 messages, detects your later reply), and `formatThread` (numbered conversation for the model).
- `fetchThread` for Gmail (threads API), Outlook (`conversationId` across all folders, so it includes Sent Items) and IMAP (best effort: References/Message-ID in the inbox and Sent).
- Personal mail is triaged with its conversation. The model returns `openQuestions`, `userPromises` and `sources`. Whether you already replied is decided **in code from the mailbox**, which suppresses redundant drafts.
- UI: "Still waiting on you", "You promised", and a Conversation panel with the source messages highlighted.
- Verified: 73 tests pass. A real-model run on a 3-message thread flagged only the unanswered question, captured the earlier promise and ignored an injected instruction (about 22 s). Live Gmail `fetchThread` returns real threads (about 100 ms each).
- Not yet verified: thread-aware triage on a real reply chain in your mailbox, because none exist yet.
- Follow-up found: Electron 45 deprecates `safeStorage.decryptString`; move `secrets.ts` to the async API before upgrading Electron.
