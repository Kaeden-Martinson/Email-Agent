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

**2026-10-24 (overnight): stage 10 (Outlook and provider hardening)**

- **Least privilege:**
  - `core/access.ts` defines the OAuth scopes per connection mode. Full: `gmail.modify`, or Graph `Mail.ReadWrite` + `Mail.Send`; never `https://mail.google.com/` (permanent delete). **Read-only**: `gmail.readonly`, or Graph `Mail.Read`.
  - You choose the mode at sign-in. Read-only mailboxes have every write permission forced off, `updateAccount` refuses to enable them, and `perform`, mailto-unsubscribe and "Draft a nudge" all check `accessBlocker` before touching the mailbox. A "Reconnect with full access" button upgrades a mailbox later.
- **Pagination:** Gmail `nextPageToken` and Graph `@odata.nextLink` up to a cap (200 on a mailbox's first sync, 100 after), so busy inboxes aren't cut off at 50.
- Provider behavior stays behind the shared `MailProvider` interface, with no Gmail/Outlook conditionals in the engine. Rate limits, transient errors, token refresh and revoked sessions are handled in the shared OAuth layer (see the reliability notes above).
- **Verified:** 158 tests pass (scope selection and access guards). In the demo, a read-only mailbox shows the banner with write controls disabled, and direct API attempts to enable archive or auto-send are refused.
- **Blocked (needs you):** a live Outlook test needs an Azure app registration on a personal Microsoft account (the school account has no access). Once the Application (client) ID is in `oauth-clients.json`, Outlook works through the same code paths. To use read-only Gmail in Testing mode, also add `gmail.readonly` under Google Auth Platform → Data Access.

**2026-10-24 (overnight): stage 11 (production readiness)**

- Checked the current Google rules (official restricted-scope verification page and the scopes list). `gmail.modify` and `gmail.readonly` are restricted. Verification needs brand verification, a public homepage, a privacy policy on the same domain, Search Console domain verification, an unlisted YouTube demo, scope justification and Limited Use compliance.
- **CASA:** required when restricted data is accessed "from or through a third-party server" or stored or transmitted on servers. Pilot has no server, so it is **probably exempt, to be confirmed with Google**. Google's wording varies across pages, so this is not claimed as fact.
- **Design consequence:** phone notifications at Sender or Full would transmit email subjects through ntfy.sh or Telegram. They stay **Minimal by default**, and the Notifications page now shows a clear warning when a phone channel is set above Minimal.
- Wrote `docs/VERIFICATION.md` (checklist with sources and what's blocked), `docs/PRIVACY_POLICY.md` (draft with placeholders, including the Limited Use statement), `docs/SECURITY.md` (every data flow, storage, safety controls, limitations) and `docs/site/index.html` (homepage template).
- **Not done (needs you):** a domain and hosting, filling in the contact details, a legal review, recording the demo video, submitting to Google, and the Azure and publisher verification.

**2026-10-24 (overnight): stage 12 (final quality pass)**

- **New unit tests** for the notification hub (de-duplication, toggles, minimal-level privacy on phone, quiet-hours hold and summary, urgent bypass, rate limit, failure recording) and the tracker (item filing and merging, receipt filtering, all-day deadlines, owed replies, promise capture, reminder firing, unless-replied skipping, unparseable phrases). **173 tests pass.**
- **Bug found by the new tests:** merged items could point back at an older email when the newer one wasn't in the store. The newest-mention time is now kept on the item.
- **Final regression in the app (demo):** every page opens, Show email loads bodies on demand, and the new Settings sections render. The installer was rebuilt from the final code. The real app restarted on the final build: synced, 0 errors in the log, data encrypted.
- Status report: `docs/STATUS.md`.

**2026-10-24: improvements without spending money (version 0.10.0)**

- **Model fallback:** Ollama 0.40.4 can't load `gemma4:e4b` ("error loading model"). Pilot now recognizes that error, switches to an installed chat model (qwen2.5 > llama3 > gemma3…, never embedding or coder models) and tells you. This covers triage, reply versions and rule parsing. The default for new installs is `qwen2.5:7b` (pulled on this PC).
- **Reply versions:** brief, friendly and formal. Tested on the real model with a 3-message thread containing an injection: about 10 s, injection ignored, and after tightening the prompt no invented facts ("I'll check on the budget approval and get back to you"). The same rule was added to normal drafts.
- **Learning from behavior:** archives, Done and sent replies are recorded (sender, priority, time only; 60 days). Three consistent actions suggest a rule; suggestions can be dismissed. "Mark all done" on a group counts once.
- **Grouping:** similar emails (same sender domain, subject without numbers or codes, within 7 days) show as one card with "+N similar".
- **Plain-English rules:** subject-word matching was added to rules. The model's reading is checked against your words in code (no invented addresses), with a preview of affected emails. Real-model test: 6 of 6 sentences parsed correctly; "delete everything from spam.io and reply" became a hide-only rule.
- **PDF attachments:** Gmail, Outlook and IMAP download up to two PDFs read-only; pdf.js extracts capped text locally; it feeds triage, date and amount verification, and Ask. Verified inside the packaged app archive. **Not yet seen on a real email** (none with a PDF arrived during testing).
- **Keyboard shortcuts and an Undo toast**, checked in the demo app (selection, Done → Undo, shortcuts overlay, rule preview).
- **Verified:** 200 tests pass; the installer `release/Inbox Pilot Setup 0.10.0.exe` was built and silently installed over 0.9.0; the installed app started as 0.10.0 and synced Gmail with no errors. **Not yet seen live:** the automatic model switch on your installed copy (no new mail arrived during the check; it will switch on the next email that needs the AI).

**2026-10-24/25: GitHub, website, calendar awareness (version 0.11.0)**

- **GitHub:** the code is public at https://github.com/Kaeden-Martinson/Email-Agent. History was checked first: no secrets (`oauth-clients.json`, tokens and mail data are gitignored and were never committed).
- **Website:** GitHub Pages serves `docs/` at https://kaeden-martinson.github.io/Email-Agent/ (homepage and `privacy.html`, generated from `PRIVACY_POLICY.md` by `npm run site`). Both returned 200 after publishing.
- **Update checks** default to this repo's latest GitHub release (older installs with no feed get it on load). Until the first release exists the check reports 404, which was seen in the installed app's log.
- **Calendar awareness:** Connect calendar per mailbox requests `calendar.freebusy` (Google) or `Calendars.ReadBasic` (Microsoft), never full calendar access. Free working-hour slots (one per day, after a 2-hour lead time) are offered in reply suggestions when an email asks to find a time, and through an Insert my free times button. Real-model test: the first prompt let the model copy the example times; after the fix, two runs used the exact real slots and never claimed a booking. Reconnect buttons keep calendar access.
- **Verified:** 205 tests pass; 0.11.0 built and installed silently over 0.10.0; the installed app started as 0.11.0 and synced with no errors. **Not verified:** a real Google free/busy call (needs the Calendar API enabled in the Cloud project, the scope added under Data Access, and Connect calendar).

**2026-10-25: finishing pass (version 0.12.0)**

- **Model check:** `gemma4:e4b` turned out to be flaky rather than broken: one request hung for over 5 minutes, another answered in 58 s, an empty load succeeded. Pilot now sends one tiny real request per session (same settings as real work, 2-minute limit) and switches models if it fails or hangs, and installs still on the old default move to `qwen2.5:7b` once. Seen on the installed copy: `model.switched gemma4:e4b → qwen2.5:7b (old default)`.
- **Google Cloud:** enabled the Google Calendar API and added `calendar.freebusy` (non-sensitive) plus the Gmail scopes under Data Access, in the user's console.
- **Smarter snooze:** Tomorrow, Next week, Until they reply (a new message from the other person in the conversation wakes it; 14-day fallback), or plain English, with a live preview and Undo.
- **Bulk cleanup:** only bulk categories, never priority 1 or mail waiting on a reply, only mailboxes with archiving allowed; preview first; each archive goes through the normal checked, logged, undoable path (max 300 per run); Undo all.
- **Writing style:** up to 40 sent emails from the last 90 days, quotes and signatures stripped, are described in one line (greeting, sign-off, length, tone); only the description is saved. Real-model test: correct description, and a planted instruction in a sample was ignored.
- **Weekly digest:** a Your week card on Today and a Monday count-only notification (safe at Minimal); bill totals only when all amounts share a currency.
- **Verified:** 217 tests pass; demo screenshots of each new screen; 0.12.0 installed and running on real data with no errors.
- **Confirmed by you after release:** v0.12.0 published on GitHub (installer size matches the build), calendar connected, and Insert my free times showed your real free times.

**2026-10-25: ready to share with family (version 0.13.0)**

- **First-run AI setup:** a new onboarding step finds Ollama (running, installed but stopped, or missing). Install Ollama for me downloads `OllamaSetup.exe` from ollama.com (1.66 GB) with progress, runs it only if Windows reports a valid Authenticode signature with subject `CN=Ollama Inc.`, installs per-user silently and starts it. Download model pulls a model sized to the PC (RAM, plus NVIDIA graphics memory when `nvidia-smi` is present) with progress and makes it Pilot's model. Today shows the same panel if the AI stops working.
- **Tested:** the signature check accepted the real `ollama app.exe`, and rejected a fake file and a validly signed non-Ollama program (node.exe). Streaming model download parsed progress to 100%. The setup step renders on a fresh profile (dev-only `--profile=` flag added for this). The full 1.66 GB installer download was not run, to spare bandwidth.
- **Bug fixed:** pressing Enter on the name step could leave the screen stuck (the redraw waited for the text box to lose focus).
- **Family guide** at `docs/install.html` (requirements, SmartScreen, AI setup, Google's unverified-app screen, weekly Reconnect). The homepage no longer claims Outlook works.
- Gmail sign-in now explains "Access blocked" (address not on the test-user list).
