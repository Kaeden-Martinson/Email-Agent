# Inbox Pilot

A desktop email assistant. Each PC has **one Pilot**, and it works for one person. You add your mailboxes (Gmail, Outlook, Yahoo, iCloud, a work or custom domain), decide what the Pilot may do in each one, and press **Start watching**.

From then on it reads new mail with a **local AI model (Ollama)** and helps you:
- **understand what matters:** the Today screen, priorities with reasons, whole-conversation summaries
- **decide what to do next:** open questions, reply drafts, deadlines and bills checked against the email
- **remember commitments:** follow-ups, promises and plain-English reminders
- **find anything:** Ask my inbox, with cited answers
- **automate safely:** rules you teach it, and a preview mode with approvals, an activity log and undo

Your email is processed on your PC; Pilot has no server. Its data and sign-ins are stored encrypted with Windows. See `docs/STATUS.md` for what's done and what's left, `docs/SECURITY.md` for every data flow, and `docs/VERIFICATION.md` for production readiness.
## How it works for the person using it

1. **First launch**: the Pilot asks your name, then asks for your first email address.
2. **Type an email address** and the Pilot works out the provider:
   - `gmail.com` and Google Workspace domains → **Sign in with Google**
   - `outlook.com`, `hotmail.com` and Microsoft 365 domains → **Sign in with Microsoft**
   - Yahoo, iCloud, AOL, Fastmail, Zoho, GMX, Comcast and most other providers → server settings are filled in automatically, and you paste an **app password** (the Pilot links you to the page that creates one)
   - Custom domains are identified from their MX records and Mozilla's ISP database (the one Thunderbird uses).
3. **Set permissions**: a new mailbox starts **paused**. Open **Permissions** and choose what the Pilot may do there:
   - **Read new mail and add it to my updates** (the watch switch)
   - **Alert me about important mail** (Windows notifications)
   - **Archive emails when I ask**
   - **Replies**: *Suggest only* / *Save drafts* / *Auto-send to trusted senders*
   - **Trusted senders** and a **signature** for this mailbox
4. **Start watching**: the Pilot checks every few minutes (5 by default) and fills the Updates list.

### How mail is read (the pipeline)

1. **Your rules** run first. A rule for a sender or domain always wins over the AI.
2. **Deterministic rules** classify obvious mailing-list mail (newsletters and promotions) instantly, with no AI. Bulk mail that mentions accounts, money, school, security or deadlines in its subject or preview is never decided this way.
3. A **quick AI read** handles automated senders and important-looking bulk mail.
4. A **full AI read** handles personal mail. It's the only stage that drafts replies.

Every email shows a **Why:** line with its reason, its stage and how long it took. **Settings → How your mail was read** shows counts, average time and how often you had to correct each stage. On the first real inbox (28 emails), stage 2 handled 18 instantly without burying any important mail.

### Conversations

Personal email is read together with its whole conversation, up to the last 8 messages, with quoted history stripped. Each email shows what's **still waiting on you** and what **you promised** earlier, and a **Conversation** panel shows the messages, highlighting the ones the summary is based on. If you've already replied after a message, Pilot checks that directly in your mailbox and won't draft another reply.

### Notifications

On the **Notifications** page:
- Choose where alerts go (this PC, the **ntfy** phone app, or your own **Telegram** bot) and what triggers them: important email, reminders, the morning briefing, bills and deadlines 24 hours ahead, follow-ups that come due, replies you were waiting on, and approvals.
- Each channel has a **privacy level**:
  - **Minimal:** "you have an important email", with no details. This is the phone default.
  - **Sender:** who and the subject. This is the desktop default.
  - **Full:** includes the summary.
- **Quiet hours** hold notifications and send one short summary afterwards. Important email can be allowed through.
- Duplicates are never sent, and phone alerts are rate-limited.
- Phone channels are off until you set them up. ntfy.sh and Telegram are cloud relays; for fully private delivery, run your own ntfy server. Tokens are stored encrypted on your PC.

The **morning briefing** can be set to every day or weekdays only, with the sections you want.

### Ask my inbox

Press **Ctrl+K**, or open **Ask**, to search or ask questions in plain English: "What did Tennessee Tech say about admissions?", "When is my next deadline?", "from:chase last month".
- Matching emails appear instantly as you type, from a local keyword index.
- **Ask** has your local AI answer using **only** those emails (plus tracked dates and your commitments when relevant), citing them as numbered chips you can click to see the exact excerpt.
- If your email doesn't contain the answer, it says so instead of guessing.
- Optional **semantic search** (Settings) adds a small local embedding model (about 270 MB, downloaded only when you click) that also finds emails phrased differently.

Everything stays on your PC.

### Today

**Today** is the home screen. It shows five tiles (need you today, overdue, replies you owe, waiting on others, awaiting approval), the morning briefing, what needs you now, and one 7-day timeline. The timeline merges bills, deadlines, appointments, your promises, follow-ups and reminders, with overdue items first.

### Deadlines & bills

Pilot pulls bills (amount and due date), deadlines, appointments, events and deliveries out of your email. Each item is **checked against the email text**:
- **Stated in the email:** the date and amount appear word for word in the quoted sentence.
- **Check the details:** something was ambiguous or conflicting. For example, "11/05" is read in US month/day order, or the email mentions several amounts. Each note says exactly what to check.
- **AI guess:** the model's quote wasn't found in the email.

If the AI and the email disagree, the email wins. Amounts the email doesn't contain are dropped. Times given in another time zone are converted to yours. Several emails about the same bill are merged into one item. **Show source** displays the exact sentence. Pilot never pays bills or moves money.

### Follow-ups

The **Follow-ups** page tracks:
- emails **you owe a reply**,
- emails you sent that asked something, where you're **waiting on them**,
- **commitments** you made ("I'll send it Friday"), from your sent mail and from conversations.

It suggests a nudge after a stated deadline, or after 3 working days by default (Settings). **Draft a nudge** saves a polite follow-up as a draft; it's never sent automatically.

**Remind me…** accepts plain English, such as "Friday", "tomorrow at 3pm", "in 2 days" or "Monday if they haven't replied", and shows exactly when it will fire before you save. "If they haven't replied" reminders check the real conversation first and quietly skip themselves when the reply has arrived.

### Teaching Pilot

Each email has **More important**, **Less important** and **Junk**. These change *only that email*. To change all future mail, use **Always from this sender…**, which creates a rule for that sender or their company domain. Domain rules for shared webmail such as gmail.com aren't allowed. After two corrections in the same direction for one sender, or when you keep archiving or replying to a sender's mail (three times in 60 days), the **Rules** page suggests a rule; **Not now** hides a suggestion. You can edit, switch off or delete any rule there.

**Describe a rule** on the Rules page takes plain English, such as `emails from billing@acme.com are important` or `hide anything with "webinar" in the subject`. Pilot shows what the rule means and which current emails it would change before you save it. Rules can match a sender, a domain, words in the subject, or a domain plus subject words. They only sort mail; they never send, delete or unsubscribe.

### Working faster

- **Keyboard:** `j`/`k` move between emails, `e` archive, `d` done, `s` snooze, `r` reply, `o` open in your mail, `g` then `u`/`t`/`d` to jump to Updates/Today/Deadlines, `Ctrl+K` to Ask, `?` for the list.
- **Undo:** Done, Snooze and Archive show an **Undo** button in the message at the bottom for 8 seconds.
- **Snooze…** offers Tomorrow, Next week, Until they reply (it comes back when the sender writes again, or after 2 weeks), or any time in plain English.
- **Bulk cleanup** (Subscriptions page): archive promotions, newsletters, notifications or spam older than 7–60 days. You see how many and which first; important emails and emails waiting on your reply are never included; Undo all puts them back.
- **Your writing style** (Replies page): Pilot reads up to 40 recent sent emails once and keeps a one-line description (greeting, sign-off, length, tone) that drafts follow. Forget it removes it.
- **Your week** on Today: emails received, what Pilot and you did, bills and deadlines in the next 2 weeks, and the noisiest senders. On Mondays a count-only notification sums it up.
- **Similar emails are grouped:** repeats of the same alert or notification within a week show as one card with "+N similar" and a **Mark all done** button.
- **Calendar-aware replies:** Mailboxes → Connect calendar grants free/busy access only. When an email asks to meet, reply suggestions offer two or three of your free working-hour slots, and the reply box has **Insert my free times**. Pilot never books or accepts anything.
- **Three reply versions:** in the reply box, **Suggest 3 versions** writes brief, friendly and formal replies aware of the whole conversation. They say you'll check rather than invent an answer.
- **PDF attachments:** bills, invoices and tickets attached as PDFs are read locally, so their due dates and amounts reach Deadlines and Ask my inbox. The card says which attachment was read.

### Activity, preview mode and undo

- Every action is logged under **Activity**: label, archive, draft, send, unsubscribe. Each entry records when it happened, which mailbox and email, why, whether it was automatic or yours, and whether it was done, failed, rejected or undone. An action is marked done only after the mail provider confirms it.
- **Preview mode** (Settings → Automation, **on by default**) turns every automatic action into a proposal you approve or reject, either in Activity or on the email itself. "Approve all" never includes sending a reply; each send needs its own approval.
- **Archive and label can be undone.** Send, draft and unsubscribe can't, and Activity says what to do instead.

### Autopilot

Each mailbox's **Permissions** panel also has an Autopilot section. Everything there is off until you turn it on:

- **Sort mail with Pilot labels**: Gmail gets labels such as `Pilot/Action` and `Pilot/Newsletters`, Outlook gets categories such as `Pilot: Action`, and IMAP mailboxes get keywords where the server supports them.
- **Archive automatically once summarized**: choose newsletters, promotions and/or notifications. Archived mail stays in the mailbox's archive and on the Done tab. Anything priority 1 or waiting on a reply is never archived, and this needs the "Archive emails when I ask" permission.
- **Unsubscribing**:
  - *Suggest* lists bulk senders under **Subscriptions**, each with an Unsubscribe button. It uses one-click unsubscribe if the sender supports it, otherwise an unsubscribe email, otherwise it opens their page.
  - *Automatic* also unsubscribes on its own after 3 newsletters or promotions from the same sender in 30 days, but **only** through the sender's RFC 8058 one-click link. The Pilot never visits an unsubscribe web page by itself.

**Morning briefing** (Settings, on by default at 08:00): once a day the Pilot writes a short summary of what needs you, deadlines and waiting drafts. It shows the summary as a Windows notification and at the top of Updates. If the PC was off at that time, the briefing comes at the next launch.

If the chosen Ollama model isn't installed, the Pilot switches to an installed chat model on its own.

**Reply rules** (shared by all mailboxes) set which kinds of email get replies, the tone, a daily auto-send limit, and whether auto-sent mail says an assistant wrote it.

### Auto-reply safeguards

These checks live in code, so nothing written in an email can talk the model past them:

- It never replies to newsletters, promotions, notifications or spam, to mailing-list or bulk mail, to no-reply senders, or to yourself.
- It sends at most one reply per thread.
- Auto-send works only for that mailbox's trusted senders, under a daily cap. Everyone else gets a draft.
- The model is told never to agree to meetings, payments or deadlines. Email text is passed to it as untrusted data.

## Developer setup (one time)

People using the app just click "Sign in with Google/Microsoft". For that to work, the app ships with its own OAuth clients, which **you create once** and put in `oauth-clients.json` next to `package.json`. Copy `oauth-clients.example.json` to start. Yahoo, iCloud and other IMAP mailboxes need no setup.

> For production readiness (verification requirements, privacy policy draft, data flows), see `docs/VERIFICATION.md`, `docs/PRIVACY_POLICY.md` and `docs/SECURITY.md`.

### Google client (Gmail and Google Workspace)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** (APIs & Services → Library). For calendar-aware replies, also enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** (Google Auth Platform): app name *Inbox Pilot*, user type **External**, and add the scope `https://www.googleapis.com/auth/gmail.modify` (plus `gmail.readonly` for read-only mailboxes and `calendar.freebusy` for Connect calendar).
3. Under **Credentials → Create credentials → OAuth client ID**, choose **Desktop app**.
4. Put the client ID and secret in `oauth-clients.json` under `google`. For desktop apps Google says the secret can't be kept confidential, so shipping it inside the app is normal.

> **Going beyond yourself:** while the app is in *Testing*, only up to 100 listed test users can sign in, and their sign-ins expire every 7 days. `gmail.modify` is a *restricted* scope, so publishing to everyone requires Google's verification, including a yearly third-party security assessment (CASA). Plan for this before a public release.

### Microsoft client (Outlook.com and Microsoft 365)

1. In the [Azure portal](https://portal.azure.com/), go to **App registrations → New registration**.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: **Public client/native (mobile & desktop)** → `http://localhost`.
4. Under **API permissions → Microsoft Graph → Delegated**, add `Mail.ReadWrite`, `Mail.Send`, `User.Read` and `offline_access`.
5. Under **Authentication**, set **Allow public client flows** to **Yes**.
6. Put the Application (client) ID in `oauth-clients.json` under `microsoft`, with tenant `common`.

> Anyone with a Microsoft account can sign in right away. Some work and school tenants require an admin to approve third-party apps, and [publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview) makes the consent screen show your verified name.

Testers can also enter their own clients under **Settings → Advanced**, which override the built-in ones.

### Local AI

Install [Ollama](https://ollama.com) and pull a model, for example:

```bash
ollama pull llama3.1:8b
```

Then choose it under **Settings → Model → Find installed**. Any chat model works, such as `qwen2.5:7b` or `gemma4:e4b`. Expect roughly 10–40 seconds per email on a mid-range GPU.

### Run from source (development)

```bash
npm install
npm start
```

Running from source turns on developer mode: Ctrl+Shift+I opens DevTools, and logs are echoed to the console. You can add `--dev` to an installed copy for the same behavior.

### Build the Windows installer

```bash
npm run dist
```

This produces `release/Inbox Pilot Setup <version>.exe`, a per-user installer (no admin rights needed) with Start Menu and desktop shortcuts. It installs to your user profile and lets you pick the folder. Uninstalling **keeps** your data. `npm run dist:dir` builds an unpacked copy in `release/win-unpacked/` for quick testing.

- **Data location:** always `%APPDATA%\inbox-pilot`, whether you run from source or install. Updates and reinstalls keep your mailboxes, rules, history and sign-ins.
- **Start with Windows** (Settings → Privacy and startup, installed app only): Pilot starts hidden in the tray.
- **Updates:** Pilot checks this repository's latest GitHub release daily (Settings → Updates; another feed can be set there, either a JSON file `{ "version", "url", "notes" }` or a GitHub "latest release" API link). Pilot only tells you about a new version; you download and install it yourself.
- **Releasing:** bump `version` in `package.json`, `npm run dist`, then create a GitHub release tagged `v<version>` and attach `release/Inbox Pilot Setup <version>.exe`.
- **Website:** `docs/` is the GitHub Pages site (homepage and privacy policy, https://kaeden-martinson.github.io/Email-Agent/). After editing `docs/PRIVACY_POLICY.md`, run `npm run site` to regenerate `docs/privacy.html`.
- **Code signing:** the installer is **unsigned**, so Windows SmartScreen will warn when you run it. To remove the warning, buy a code-signing certificate and add it to the `build.win` settings in `package.json` (see electron-builder's code-signing docs).

### Reliability and troubleshooting

- **Encrypted data:** Pilot's data is encrypted with Windows (DPAPI) by default (Settings → Privacy). Sign-in tokens always are.
- **Backups:** one backup per day is kept for 7 days in `backups/`. If the data file is ever unreadable, it's kept aside (never overwritten) and the newest good backup is restored, with a notice.
- **Saving:** writes are atomic, and Pilot waits for pending writes before quitting or when Windows signs out.
- **Crashes:** if the window's renderer crashes, it reloads automatically. Unexpected errors are logged, not fatal.
- **Logs:** structured logs are kept in `logs/` for 14 days. They never contain email text, addresses or passwords. Settings → Troubleshooting opens the logs and data folders.
- **Rate limits:** Gmail and Outlook rate limits and server errors are retried with backoff (honoring Retry-After). An expired or revoked access token is refreshed once automatically, and refreshes are single-flight per mailbox.

### Tests

```bash
npm test
```

The tests cover the safety rules (reply blockers, trusted senders, the daily cap, auto-archive and auto-unsubscribe limits, header injection), the prefilter, learned rules and corrections, and the guard rails on model output.

To try the interface with sample data and no accounts:

```bash
npm run demo
```

## Where things are stored

All in `%APPDATA%\inbox-pilot\` (demo mode uses a `demo` subfolder):

- `state.json`: your name, settings, mailboxes and their permissions, and the updates list. Up to 1000 emails are cached, and finished items are pruned after 14 days.
- `tokens.bin`: OAuth tokens and IMAP app passwords, encrypted with Windows DPAPI via Electron `safeStorage`.

Removing a mailbox deletes its sign-in and its updates from the app. Nothing in the mailbox itself is deleted.

## Project layout

```
src/
  main/              Electron main process
    main.ts          window, tray, notifications, IPC
    engine.ts        watch loop, pipeline, autopilot, activity log, rules, briefing
    core/            pure, unit-tested logic: policy.ts (safety), prefilter.ts, rules.ts
    clients.ts       built-in OAuth clients (oauth-clients.json) + overrides
    oauth.ts         desktop OAuth (PKCE + loopback redirect)
    secrets.ts       encrypted tokens and passwords
    store.ts         JSON state + defaults
    ai/              Ollama client and triage prompt/schema
    providers/
      discovery.ts   email address → provider + server settings
      gmail.ts       Gmail API
      outlook.ts     Microsoft Graph
      imap.ts        IMAP/SMTP for everything else
  preload/           the window.api bridge
  renderer/          UI (plain TypeScript, no framework)
  shared/types.ts    types shared across all three
```

## Ideas for next steps

- Calendar awareness, so drafts can propose real free times
- Reading other attachment types (Word documents, images with OCR)
- Publishing the Google app (needs the homepage and privacy policy hosted, for example on GitHub Pages)
