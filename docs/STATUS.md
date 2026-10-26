# Lodestar: status (2026-10-25, version 0.14.0)

## What's done

| # | Stage | State |
|---|---|---|
| 1 | Git + test harness | Done. **226 tests** passing; public on GitHub; safety logic in pure modules under `src/main/core`. |
| 2 | Fast multi-stage pipeline | Done. Rules → prefilter → quick AI → full AI; 18 of 28 real emails needed no AI. |
| 3 | Learned rules, activity log, preview, undo | Done. Rules can also be written in plain English, and Lodestar learns from what you archive and reply to. |
| 4 | Thread understanding | Done. Whole conversations, quote stripping, open questions, promises, source messages. |
| 5 | Follow-ups and commitments | Done. Waiting-on, owed replies, promises, plain-English reminders. |
| 6 | Deadlines, bills, Today command center | Done. Extraction verified against the email text, now including PDF attachments. |
| 7 | Ask my inbox | Done. Local search plus semantic search (model installed), cited AI answers. |
| 8 | Notifications | Done. Desktop, ntfy (set up, Minimal), Telegram; privacy levels, quiet hours, rate limits. |
| 9 | Installable Windows app | Done. Installed, starts with Windows (hidden). |
| 10 | Outlook and provider hardening | Done in code. **Live Outlook untested** (needs Azure). |
| 11 | Production readiness | Homepage and privacy policy live at https://kaeden-martinson.github.io/Lodestar/. Google publishing still needs the steps below. |
| 12 | Engineering quality | Done. Encrypted data, backups, migrations, recovery, redacting logs. |

New in 0.14.0: the Graphite redesign. Every screen was rebuilt (Today, Updates with a reading pane, Ask as a conversation, Deadlines as a weekly list, Follow-ups in two columns, Mailboxes, Rules as a table, Activity as a timeline, Settings with a sub-menu, a new first-run screen), with Light, Dark and Match Windows themes, SVG icons instead of emoji, and the new name Lodestar with a star logo. The old stylesheet is gone. Checked in the demo app in light and dark and on a fresh profile; not yet installed over your running copy.

New in 0.13.0: first-run AI setup (installs Ollama after checking its signature, downloads a model sized to the PC), a family install guide on the website, and a hint when Google blocks an address that isn't a test user.

New in 0.12.0: smarter snooze (until they reply, plain-English times), bulk cleanup with preview and Undo all, learning your writing style, the weekly digest, and a once-per-session check that the AI model really answers.

New in 0.11.0: calendar-aware replies (free/busy only), update checks from GitHub Releases, and the public website.

New in 0.10.0: three reply versions (brief, friendly, formal), grouped similar emails, plain-English rules with preview, behavior-based rule suggestions, PDF attachment reading, keyboard shortcuts (`?`), Undo in the toast, one-click Reconnect, and automatic model fallback when Ollama can't load a model.

## Verified on your real setup

- **Gmail:** sync, threads, sent mail, triage, extraction, Ask; a real archive followed by Undo restored the email to the inbox.
- **Installed app:** 0.12.0 installed over 0.11.0 with data kept; switched itself from the old `gemma4:e4b` to `qwen2.5:7b`; synced, no errors; update check reads the GitHub release.
- **Calendar:** connected on your Gmail; Insert my free times showed your real free times.
- **Releases:** v0.11.0 and v0.12.0 published on GitHub; the installed app's update check reads them.
- **Google Cloud:** Calendar API enabled and `calendar.freebusy` added under Data Access (Google lists it as non-sensitive).
- **AI:** `qwen2.5:7b` gives reply versions in about 10 s with no invented facts, and parses plain-English rules correctly (6 of 6 tests).
- **PDF reading** works inside the packaged app.
- **Housekeeping:** the plain-text safety copies were deleted.

## Sharing with family and friends

- Install guide for them: https://kaeden-martinson.github.io/Lodestar/install.html
- For each Gmail user: add their address under Google Auth Platform → Audience → Test users (max 100).
- First run installs Ollama and a right-sized model for them.

## Not verified, or blocked on you

| Item | Why | What to do |
|---|---|---|
| 0.14.0 on your installed copy | The installer is built, but installing over the running app, the GitHub release and the old Inbox Pilot shortcut cleanup wait for the final review | Run `release/Lodestar Setup 0.14.0.exe` after review; check the Start menu and desktop shortcut say Lodestar. |
| PDF on a real email | None with a PDF arrived during testing | Check the next bill or invoice card; it says "Read the attached …". |
| Phone notifications | Needs the ntfy app on your phone | Install ntfy and subscribe to topic `pilot-b3cqclzslv9p`. |
| Writing style on real data | Reads your sent mail, so it waits for you | Replies → Learn my writing style. |
| Google's 7-day sign-out | Apps in Testing get signed out weekly | Use **Reconnect** when asked. To end it: verify `kaeden-martinson.github.io` in Google Search Console, add the homepage and privacy URLs under Branding, then Publish app. Restricted Gmail scopes still need Google's verification for anyone but you and your test users. |
| Outlook | Needs an Azure app registration on a personal Microsoft account | See README → Microsoft client. |
| Telegram | Needs your bot token | Notifications → Telegram. |
| Code signing | Needs a paid certificate | See `docs/VERIFICATION.md`. |

## Performance note

AI reads take about 10–20 s per email, and much longer when another program is using most of the GPU. Bulk mail needs no AI and is instant.
