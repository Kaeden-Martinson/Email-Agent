# Pilot: data flows and security

This page says exactly what data Pilot touches, where it goes, and how it is protected. It describes the code in this repository as of version 0.12.0.

## Where data goes

| Data | Goes to | When | Notes |
|---|---|---|---|
| Your mail (read, archive, label, drafts, send) | Google (Gmail API) or Microsoft (Graph), or your IMAP/SMTP server | Only for mailboxes you connect and watch | Over HTTPS/TLS with your OAuth token or app password. Read-only connections can never write or send. |
| PDF attachments (up to two per email, 10 MB each) | Downloaded read-only from your mail provider, read **on your PC** with pdf.js | When the AI reads an email that has a PDF | Only the extracted text is kept (capped at 6,000 characters, inside the encrypted data file); the file itself is not saved. |
| Calendar free/busy times (only after Connect calendar) | Read from Google Calendar or Microsoft Graph | When you ask for reply suggestions on an email about meeting, or press Insert my free times | Busy start and end times only, never titles or attendees; cached in memory for 10 minutes, not saved. |
| Email text for summaries, drafts, extraction and answers | **Your local Ollama** (`http://127.0.0.1:11434` by default) | Each new email; when you Ask | Stays on your PC. If you point the Ollama address at another machine, mail goes there instead, so keep it local. |
| Embeddings (only if you turn on semantic search) | Local Ollama, stored in `embeddings.json` | In the background after syncs | Numeric vectors derived from your mail, stored on your PC. |
| Phone notifications | ntfy (ntfy.sh or your own server) or Telegram | Only if you turn on a phone channel | At **Minimal** (the default), no email content is sent, only "you have an important email" or counts. At Sender or Full, senders, subjects and summaries go through that service. |
| The **domain** of an address you add (for example `yahoo.com`) | Mozilla's autoconfig database (Thunderbird ISPDB) and Cloudflare DNS-over-HTTPS | When you add a mailbox | Only the domain, never the full address or any mail. |
| One-click unsubscribe | The sender's own unsubscribe URL (RFC 8058 POST) | When you click Unsubscribe, or automatic mode for repeat senders | The request body is `List-Unsubscribe=One-Click`, nothing else. |
| Update check | The update feed URL you configure (none by default) | Daily, if configured | Only a GET request, with no data from your mail. |
| Model download | Ollama's model registry | Only when you click to enable semantic search | Downloads `nomic-embed-text`; no data from your mail. |

Pilot has **no server of its own**. Nothing is sent to the app's developer.

## Stored on your PC (`%APPDATA%\inbox-pilot`)

| File | Contents | Protection |
|---|---|---|
| `state.enc` | Settings, mailboxes, rules, history, cached mail (up to 1000 emails, 14 days for finished items) | Encrypted with Windows DPAPI through Electron safeStorage (default on). A plain `state.json` is written instead only if you turn encryption off. |
| `tokens.bin` | OAuth tokens, IMAP app passwords, notification tokens | Always DPAPI-encrypted; never sent to the UI process. |
| `backups/` | Daily copies of the data file, 7 days | Encrypted when encryption is on. |
| `embeddings.json` | Semantic search vectors (optional) | Not encrypted; derived numbers, not text. |
| `logs/` | Troubleshooting events, 14 days | Content fields removed, and addresses and tokens masked (`core/redact.ts`). |

DPAPI ties encryption to your Windows account. Another Windows user on the same PC, or someone with only the copied files, can't read them.

## Safety controls (enforced in code, not by the AI)

- **Untrusted email content:** email text, including text from PDF attachments, is passed to the model as data, inside delimiters, with instructions to ignore commands found in it. The model's output is constrained to a JSON schema and validated (`normalizeTriage`, `verifyItem`, `cleanAnswer`).
- **Automation is off by default** and set per mailbox. Preview mode (on by default) turns automatic actions into proposals you approve.
- **Hard reply blockers** (`core/policy.ts`): never to bulk mail, no-reply senders, yourself, threads already answered, or junk categories.
  - Auto-send only goes to your trusted senders, under a daily cap.
  - "Approve all" never includes sending.
- **Unsubscribing automatically** uses only RFC 8058 one-click, never visiting web pages.
- **Read-only connections** are checked before every mailbox write (`core/access.ts`).
- **Scopes:** full access never requests Gmail's `https://mail.google.com/` (permanent delete) scope.
- **Every action is logged in Activity.** It's marked done only after the provider confirms, and archive and label can be undone.
- **Bulk cleanup only archives,** never deletes; it skips important mail and mail waiting on a reply, goes through the same permission and read-only checks as one archive, and logs every email so each (or all) can be undone.
- **Writing style** is a one-line description learned from your sent mail on request; the sent emails themselves are not stored.
- **Rules only sort.** Rules written in plain English are parsed by the local model, then checked in code: every address, domain and subject phrase must appear in what you typed, and the only possible effects are important, low priority or hidden. You see a preview before anything is saved.
- **Reply versions never commit you.** The three suggested replies are drafts for you to edit and send; the prompt forbids agreeing to meetings, payments or deadlines and inventing facts.
- **Financial data:** Pilot extracts bill amounts but never initiates payments or opens payment links on its own.
- **Header injection:** reply subjects from untrusted email are stripped of CR/LF before building messages.
- **The renderer is sandboxed:** context isolation is on, Node integration off, sandbox on, a strict Content Security Policy is set, navigation and new windows are blocked, and only https links open externally.

## Known limitations

- **The installer is unsigned,** so Windows SmartScreen warns on install.
- **DPAPI protects against other accounts and file theft,** not against malware running as you.
- **`embeddings.json` is unencrypted** (derived vectors).
- **Your mail provider sees Pilot's API calls,** as with any mail client.
