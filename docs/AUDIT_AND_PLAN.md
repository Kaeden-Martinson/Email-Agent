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

**2026-10-24: stage 5 delivered (follow-ups and commitments)**

- `core/when.ts`: a deterministic natural-language time parser (weekdays, "next Friday", relative times, dates, "end of week", plus "…if they haven't replied" in many phrasings) and deadline extraction ("by Friday" → end of day). It caught a real bug in testing ("end of week" defaulted to 9am).
- `core/followups.ts`: does your sent email expect a reply (quoted history ignored, acknowledgements excluded), commitments in your sent mail with deadlines, reply detection, and the follow-up date (stated deadline, otherwise N working days, skipping weekends).
- `tracker.ts`: scans sent mail (Gmail `in:sent`, Outlook Sent Items, IMAP Sent folder), turns stage-4 promises into commitments, and re-checks the real conversations for replies (throttled, 15 per sync). Reminders run every minute and on launch; "unless replied" reminders check the live conversation first, and are skipped and logged as "Resolved automatically" if a reply exists.
- "Draft a nudge" saves a reply-all follow-up **as a draft only** and logs it in Activity.
- Follow-ups dashboard: reminders due, you owe a reply, waiting on them, your commitments, scheduled reminders, resolved automatically. "Remind me…" with a live preview on emails and dashboard rows. The briefing mentions follow-ups that are due.
- Verified: 96 tests pass; demo run (a due reminder fired, an unless-replied reminder was skipped when the reply existed, the preview parsed and the reminder saved). Real Gmail scan: 4 automated sent emails gave 0 follow-ups and 0 commitments, so no false positives.
- Not yet verified on real data: an actual waiting-on-them item, because your sent mail has no questions yet.

**2026-10-24: stage 6 delivered (deadlines, bills and the Today command center)**

- `core/extract.ts`: money amounts, calendar dates (month names, ISO, numeric with an ambiguity note, year inference, times, stated time zones converted to local), and `verifyItem`, which checks the model's extraction against the email: email over model on conflicts, amounts the email doesn't contain are dropped, quotes not found are marked "AI guess", plus confidence and notes. Guards: only ask the model when the email mentions dates or money (saves output tokens), and drop receipts and undated non-bills.
- Triage schema adds `keyItems` (kind, title, date, time, amount, currency, verbatim evidence). `tracker.ingestItems` verifies, files and merges duplicates (same kind, day, amount and sender domain); reminders work on items; items count toward overdue; the briefing mentions bills due in the next 3 days.
- UI: **Today** home screen (tiles, briefing, needs you now, a 7-day timeline merging bills, deadlines, promises, follow-ups and reminders); **Deadlines & bills** (grouped Overdue / Next 7 days / Later / No date, confidence pills, conflict notes, Show source, Remind me, Done); key-date chips on email cards.
- Backfill: earlier non-bulk mail that mentions dates or money is scanned 3 at a time, **for dates and amounts only**. An earlier version re-ran the whole pipeline and replaced 8 low-priority bulk summaries; that was caught, fixed and the summaries restored from backup before commit.
- Bug found by tests: a Python edit had turned regex `` into literal backspace characters, silently disabling the deadline-word check. Fixed; the source tree was scanned for control characters.
- Verified: 112 tests pass. Real model: the Tennessee Tech event was extracted exactly (Oct 29, 5:30 PM, high confidence); a synthetic Verizon bill picked the amount due (not the total balance) and flagged the US-format date. Real inbox backfill found that event and correctly produced nothing from security alerts or receipts.
- Performance note: triage took 46–56 s per email during testing because another process was using about 92% of the GPU and 7.5 of 8 GB VRAM, pushing gemma4 mostly onto the CPU. Under normal load it is about 10–22 s.

**2026-10-24: stage 7 delivered (Ask my inbox)**

- `core/search.ts`: tokenizer with light stemming, plus stop words and question words ("find", "email", "mentioned"); query filters (`from:`, `subject:`, `after:`, `before:`, "yesterday", "last week", "this month", "last N days", "from Rent Co"); BM25 with subject and sender weighted 3×; weak single-word matches dropped when better matches exist; cosine similarity; reciprocal rank fusion; snippets.
- `core/answer.ts`: numbered sources for the model, then `cleanAnswer`, which keeps only citations that exist (including multi-source markers like `[1, 7]`), strips markers that point nowhere, and never marks an uncited or "not found" answer as verified.
- `ask.ts`: instant keyword results (about 1–8 ms on the real inbox), optional semantic search through a local embedding model (fused with keyword ranking, still respecting filters), and AI answers from the local model using only the retrieved emails plus tracked dates and commitments when relevant. Email content is passed as untrusted data.
- Semantic search is **opt-in**: gemma4 can't produce embeddings, so Settings offers a confirmed ~270 MB download of `nomic-embed-text`. It has not been downloaded (your decision), so semantic search is untested end to end; keyword search is fully working.
- UI: Ask page (Ctrl+K), results as you type with highlighted words, answers with clickable citation chips that open the quoted source, an "Open email" link, and clear "Not in your email" and "No sources cited" states.
- Verified: 130 tests pass. On the real inbox: TT admissions (cited both TT emails), next deadline (cited the email and the tracked date), refund ("couldn't find anything", correct), Payoneer amount ($90.00, cited both). The demo UI rendered an answer citing an email, a tracked date and a commitment; citation chips open and close their sources.

**2026-10-24: stage 8 delivered (notifications)**

- `core/notify.ts`: wording at three privacy levels. **Minimal** says only that something happened, **Sender** adds who and the subject, **Full** adds the summary. Briefings below Full are count-only. Also quiet-hours checks (overnight ranges) and the "while you were away" summary.
- `notifier.ts`: one hub for desktop, ntfy and Telegram, with per-channel event toggles and privacy level, de-duplication by key, quiet hours (held, then one summary), and a phone rate limit (default 10 per hour). Tokens are stored encrypted (`channelSecrets`) and never sent to the UI. ntfy uses JSON publishing (any server, optional token); Telegram uses a bot token plus "Find my chat" (getUpdates).
- Events routed through the hub: important email (still gated per mailbox), reminders, the briefing, deadlines within 24 hours, follow-ups that come due, replies you were waiting on, and approvals waiting. The old direct desktop notifications in main.ts were removed so nothing is shown twice.
- Configurable briefing: days (every day or weekdays), sections, and per-channel delivery.
- Defaults: desktop on at Sender; phone channels **off** and at **Minimal**; quiet hours off; ntfy topic is a generated random name; the UI explains that ntfy.sh and Telegram are cloud relays and how to self-host ntfy.
- Verified: 139 tests pass. End to end through the real Notifier to ntfy.sh on a throwaway topic with fake data: test, urgent (high priority) and quiet-hours summary all delivered; the duplicate was suppressed; nothing leaked at Minimal; 2 held notifications became 1 summary. Telegram is untested (needs your bot token).
- Also fixed: demo mode no longer runs the date backfill (it called the model on demo data).

**2026-10-24 (overnight): reliability layer and stage 9 (installable Windows app)**

- **Data safety:**
  - New `Store` with async open, atomic serialized writes, encryption at rest (DPAPI via async safeStorage, verified by reading back before replacing the old file), daily backups kept for 7 days and encrypted when encryption is on, and versioned migrations (`core/migrate.ts`, schema 2).
  - **Fixed a data-loss bug:** an unreadable `state.json` used to be silently replaced with an empty one. Now it's moved aside and the newest readable backup is restored, with a notice in the app.
- Secrets moved to the async safeStorage API (fixing the Electron 45 deprecation), with re-encryption after key rotation and queued writes flushed at quit.
- **Logging:** structured JSON logs (`logger.ts`) through `core/redact.ts`, which strips content fields and masks addresses and tokens. A scan of the real log found 0 matches for your address, Google tokens or the client secret.
- **Provider calls:** `core/retry.ts` (429/5xx with backoff and Retry-After) in the shared OAuth API layer; a 401 triggers one forced refresh; refreshes are single-flight per account (Microsoft rotates refresh tokens, so parallel refreshes could sign you out); `invalid_grant` gives a clear "reconnect" message, including Google's 7-day Testing-mode expiry.
- **Performance:** state pushes no longer include email bodies; "Show email" fetches the body on demand.
- **Stage 9:**
  - Stable data folder (`%APPDATA%\inbox-pilot` for source and installed builds); launch at login (installed app only, starts hidden in the tray); update checks against a configurable feed (notify only; parsing in `core/version.ts`); developer mode (source or `--dev`: DevTools and console logs).
  - Crash recovery (renderer reload, uncaught errors logged); safe shutdown (waits for data and secret writes, saves on Windows session end).
  - Generated icon; electron-builder NSIS config (per-user, keeps data on uninstall).
- **Verified:** 153 tests pass. Store tested on a copy of the real data: migrate, encrypt, reopen, corrupt and restore from backup, encryption off. The packaged `Inbox Pilot.exe` ran in demo mode (version 0.9.0, packaged true, synced, encrypted data). Package contents checked (app, UI, dependencies and oauth-clients.json included; no source or tests). The installer `release/Inbox Pilot Setup 0.9.0.exe` was built. **Not run:** installing changes your system, so that's left for you. The real app migrated to encrypted storage with all 28 emails, and its backup is encrypted.
- **Not done (needs you):** code signing requires buying a certificate; publishing releases and an update feed requires choosing hosting (for example GitHub Releases).
