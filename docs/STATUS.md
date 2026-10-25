# Pilot: status (2026-10-25, version 0.11.0)

## What's done

| # | Stage | State |
|---|---|---|
| 1 | Git + test harness | Done. **205 tests** passing; public on GitHub; safety logic in pure modules under `src/main/core`. |
| 2 | Fast multi-stage pipeline | Done. Rules → prefilter → quick AI → full AI; 18 of 28 real emails needed no AI. |
| 3 | Learned rules, activity log, preview, undo | Done. Rules can also be written in plain English, and Pilot learns from what you archive and reply to. |
| 4 | Thread understanding | Done. Whole conversations, quote stripping, open questions, promises, source messages. |
| 5 | Follow-ups and commitments | Done. Waiting-on, owed replies, promises, plain-English reminders. |
| 6 | Deadlines, bills, Today command center | Done. Extraction verified against the email text, now including PDF attachments. |
| 7 | Ask my inbox | Done. Local search plus semantic search (model installed), cited AI answers. |
| 8 | Notifications | Done. Desktop, ntfy (set up, Minimal), Telegram; privacy levels, quiet hours, rate limits. |
| 9 | Installable Windows app | Done. Installed, starts with Windows (hidden). |
| 10 | Outlook and provider hardening | Done in code. **Live Outlook untested** (needs Azure). |
| 11 | Production readiness | Homepage and privacy policy live at https://kaeden-martinson.github.io/Email-Agent/. Google publishing still needs the steps below. |
| 12 | Engineering quality | Done. Encrypted data, backups, migrations, recovery, redacting logs. |

New in 0.11.0: calendar-aware replies (free/busy only), update checks from GitHub Releases, and the public website.

New in 0.10.0: three reply versions (brief, friendly, formal), grouped similar emails, plain-English rules with preview, behavior-based rule suggestions, PDF attachment reading, keyboard shortcuts (`?`), Undo in the toast, one-click Reconnect, and automatic model fallback when Ollama can't load a model.

## Verified on your real setup

- **Gmail:** sync, threads, sent mail, triage, extraction, Ask; a real archive followed by Undo restored the email to the inbox.
- **Installed app:** 0.10.0 installed over 0.9.0 with data kept; started, synced, no errors; Start with Windows registered.
- **AI:** `qwen2.5:7b` gives reply versions in about 10 s with no invented facts, and parses plain-English rules correctly (6 of 6 tests).
- **PDF reading** works inside the packaged app.
- **Housekeeping:** the plain-text safety copies were deleted.

## Not verified, or blocked on you

| Item | Why | What to do |
|---|---|---|
| Model switch on your installed copy | Your saved model is `gemma4:e4b`, which Ollama can't load; no new mail arrived during the check | Nothing; the next email that needs the AI switches it to `qwen2.5:7b` and shows a message. Or pick the model in Settings now. |
| PDF on a real email | None with a PDF arrived during testing | Check the next bill or invoice card; it says "Read the attached …". |
| Phone notifications | Needs the ntfy app on your phone | Install ntfy and subscribe to topic `pilot-b3cqclzslv9p`. |
| First GitHub release | The installer (134 MB) is too big for me to upload through the browser | On the open release page, drag in `release/Inbox Pilot Setup 0.11.0.exe` and click Publish release. Update checks start working then. |
| Calendar on real data | Needs Google Cloud changes and your consent | Enable the Google Calendar API, add `calendar.freebusy` under Google Auth Platform → Data Access, then Mailboxes → Connect calendar. |
| Google's 7-day sign-out | Apps in Testing get signed out weekly | Use **Reconnect** when asked. To end it: verify `kaeden-martinson.github.io` in Google Search Console, add the homepage and privacy URLs under Branding, then Publish app. Restricted Gmail scopes still need Google's verification for anyone but you and your test users. |
| Outlook | Needs an Azure app registration on a personal Microsoft account | See README → Microsoft client. |
| Telegram | Needs your bot token | Notifications → Telegram. |
| Code signing | Needs a paid certificate | See `docs/VERIFICATION.md`. |

## Performance note

AI reads take about 10–20 s per email, and much longer when another program is using most of the GPU. Bulk mail needs no AI and is instant.
