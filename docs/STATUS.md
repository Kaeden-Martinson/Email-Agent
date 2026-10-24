# Pilot: status (2026-10-24, version 0.9.0)

## What's done

| # | Stage | State |
|---|---|---|
| 1 | Git + test harness | Done. **173 tests** passing; safety logic in pure modules under `src/main/core`. |
| 2 | Fast multi-stage pipeline | Done. Rules → prefilter → quick AI → full AI; 18 of 28 real emails needed no AI. |
| 3 | Learned rules, activity log, preview, undo | Done. |
| 4 | Thread understanding | Done. Whole conversations, quote stripping, open questions, promises, source messages. |
| 5 | Follow-ups and commitments | Done. Waiting-on, owed replies, promises, plain-English reminders. |
| 6 | Deadlines, bills, Today command center | Done. Extraction verified against the email text. |
| 7 | Ask my inbox | Done. Local search, cited AI answers; semantic search optional. |
| 8 | Notifications | Done. Desktop, ntfy, Telegram; privacy levels, quiet hours, rate limits. |
| 9 | Installable Windows app | Done. `npm run dist` builds the installer; auto-start, update checks, crash recovery, dev mode. |
| 10 | Outlook and provider hardening | Done in code. Read-only mode, pagination, retries, token handling. **Live Outlook untested.** |
| 11 | Production readiness | Docs done. Verification checklist, privacy policy draft, data flows, homepage template. |
| 12 | Engineering quality | Done. Encrypted data, backups, migrations, recovery, redacting logs. |

Commit history: `git log --oneline` shows one commit per stage.

## Verified on your real setup

- **Gmail:** sync, thread fetch, sent-mail scan, triage, extraction, Ask.
- **Data:** migrated to encrypted storage with all 28 emails intact; the daily backup is encrypted; logs contain no addresses or tokens.
- **ntfy:** real delivery to ntfy.sh, using a throwaway topic and fake data.
- **Packaged app:** ran in demo mode; package contents checked; installer built.

## Not verified, or blocked on you

| Item | Why | What to do |
|---|---|---|
| Outlook | Needs an Azure app registration; your school account can't create one | Create a free Azure account on a personal Microsoft account, register the app (README), put the client ID in `oauth-clients.json`. |
| Telegram | Needs your bot token | Notifications → Telegram → follow the 4 steps. |
| Semantic search | Needs a ~270 MB model download (your choice) | Settings → "Download nomic-embed-text…". |
| Installing the app | Changes your system | Run `release/Inbox Pilot Setup 0.9.0.exe`. It's unsigned, so SmartScreen will warn ("More info" → "Run anyway"). |
| Code signing | Needs a purchased certificate | See `docs/VERIFICATION.md`. |
| Google verification | Needs a domain, hosting, a demo video and submission | See `docs/VERIFICATION.md` (the CASA question needs confirming with Google). |
| Undo on real Gmail | No automatic action has been enabled on your mailbox yet | Try labels or auto-clean with preview mode on, approve, then undo. |

## Housekeeping for you

During development I made **plain-text safety copies** of your data before risky changes. They're no longer needed and aren't encrypted, so delete them once you're happy:

```
%APPDATA%\inbox-pilot\state.json.bak
%APPDATA%\inbox-pilot\state.pre-stage3.json
%APPDATA%\inbox-pilot\state.pre-stage6.json
%APPDATA%\inbox-pilot\state.pre-encryption.json
```

The encrypted `state.enc` and `backups\` hold your current data.

## Performance note

AI reads took about 10–20 s per email normally, but 40–56 s when another program was using most of the GPU (about 92%, 7.5 of 8 GB VRAM) during development. Closing other GPU-heavy apps speeds Pilot up a lot. Bulk mail (most of your inbox) needs no AI and is instant.

## Suggested next steps

1. Install the app, turn on **Start with Windows**, and set up ntfy on your phone (keep **Minimal**).
2. Set up Outlook (Azure) if you use it.
3. Try the autopilot features in preview mode for a week, then turn preview off for the ones you trust.
4. When ready to share Pilot: code signing, homepage, privacy policy, Google verification.
