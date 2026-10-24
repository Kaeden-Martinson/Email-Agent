# Inbox Pilot

A desktop email assistant. Each PC has **one Pilot**, and it works for one person. You add your mailboxes (Gmail, Outlook, Yahoo, iCloud, a work or custom domain), decide what the Pilot may do in each one, and press **Start watching**. From then on it reads new mail with a **local AI model (Ollama)** and keeps a short list of what needs you, what's worth a look and what's safe to ignore. In the mailboxes where you allow it, it also drafts or sends replies.

Email content never leaves the PC. The AI runs in Ollama on this machine, and the app talks only to your mail providers and your local Ollama.

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

### Google client (Gmail and Google Workspace)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (Google Auth Platform): app name *Inbox Pilot*, user type **External**, and add the scope `https://www.googleapis.com/auth/gmail.modify`.
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

### Run

```bash
npm install
npm start
```

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
    engine.ts        watch loop, triage queue, per-mailbox permissions, reply rules
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

- Request read-only access when a mailbox's permissions don't need send or archive
- Calendar awareness, so drafts can propose real free times
- Per-sender rules ("always low priority", "always draft")
- Learning your tone from your sent mail
- An installer via electron-builder, plus launch at login
