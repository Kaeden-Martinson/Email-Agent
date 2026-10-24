# Inbox Pilot privacy policy (draft)

> **Draft for review.** Before publishing:
> - Have it reviewed.
> - Google requires the privacy policy to be hosted on the **same domain** as the app's public homepage.
> - This draft reflects Inbox Pilot 0.10.0 as built. Update it whenever data handling changes.

*Last updated: October 24, 2026*

Inbox Pilot ("Pilot", "we") is a desktop email assistant that runs on your computer. This policy explains what Pilot does with your information. In short: **your email is processed on your computer and is not sent to us.** We do not operate servers that receive your email.

## What Pilot accesses

When you connect a Google, Microsoft or other email account, Pilot accesses:
- **Email messages and their metadata** (sender, recipients, subject, date, labels or folders, message body, and the text of PDF attachments) in the mailboxes you choose to watch, and your sent messages (to track replies you're waiting on).
- **Your email address,** to identify the mailbox.
- **Your calendar's free/busy times,** only if you choose Connect calendar: when you are busy, never event titles, attendees or details. They are used only to suggest free times in reply drafts you review; Pilot never creates or changes calendar events.

Depending on the access you grant and the permissions you enable for each mailbox, Pilot may also, **only when you allow it**:
- archive messages
- apply labels or categories
- save reply drafts
- send replies you approve, or replies to senders you've marked as trusted
- send one-click unsubscribe requests

If you connect a mailbox **read-only**, Pilot can only read it.

## How Pilot uses this data

Pilot uses your email data only to provide its features to you:
- summaries
- priorities
- reply drafts
- deadline and bill tracking
- follow-up reminders
- search and answers about your mail
- the actions you authorize

Email content is analyzed by an AI model that runs **on your own computer** (Ollama). Pilot does not use your data for advertising, does not sell it, and does not use it to train AI models.

## Where your data is stored

Pilot stores summaries, settings, recent messages and its history in your Windows user profile (`%APPDATA%\inbox-pilot`), encrypted with Windows' built-in data protection by default. Sign-in tokens and passwords are always stored encrypted. You can delete all Pilot data at any time by removing a mailbox in the app (which deletes its sign-in and stored messages) or by deleting that folder.

## When data leaves your computer

- **Your email provider** (Google, Microsoft or your mail server), to read and act on your mail as you direct.
- **Phone notifications,** only if you turn them on:
  - At the default "Minimal" level, no email content is included.
  - At the "Sender" or "Full" level, email senders, subjects and summaries are sent through the notification service you chose (ntfy or Telegram) under that service's privacy policy.
- **Setup lookups:** when you add a mailbox, only the address's **domain** (for example "example.com") is looked up to find server settings, using Mozilla's public autoconfig database and Cloudflare DNS.
- **One-click unsubscribe requests** go to the sender's unsubscribe address when you, or automatic mode, unsubscribe.

We do not receive any of this data.

## Google user data

Inbox Pilot's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Specifically:
- Google user data is used only to provide or improve user-facing features that are prominent in Pilot's interface.
- It is not transferred to others except as needed to provide those features (for example, to a notification service you configure), to comply with law, or as part of a merger or acquisition with notice to you.
- It is not used for advertising.
- No human reads it, unless you give consent for specific messages, it's needed for security purposes, or the law requires it.

## Children

Pilot is not directed to children under 13.

## Changes

We will update this policy when Pilot's data handling changes and note the date above.

## Contact

Questions or requests: open an issue at https://github.com/Kaeden-Martinson/Email-Agent/issues
