import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import type { Account, Address, Category, EmailMessage, ServerConfig } from '../../shared/types';
import { passwords } from '../secrets';
import type { MailProvider } from './base';
import { cleanBody, formatAddress, htmlToText, isBulkMail, LABEL_NAMES, parseListUnsubscribe, reSubject } from './mime';

function imapClient(email: string, password: string, server: ServerConfig): ImapFlow {
  return new ImapFlow({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: { user: email, pass: password },
    logger: false,
  });
}

function friendlyError(e: unknown): Error {
  const err = e as { authenticationFailed?: boolean; code?: string; message?: string };
  if (err.authenticationFailed) {
    return new Error('The email address or password was not accepted. Most providers need an app password here, not your normal password.');
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return new Error(`Couldn't reach the mail server (${err.code}). Check the server settings.`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Logs in once to prove the settings and password work, before the account is saved. */
export async function verifyImap(email: string, password: string, server: ServerConfig): Promise<void> {
  const client = imapClient(email, password, server);
  try {
    await client.connect();
    await client.logout();
  } catch (e) {
    throw friendlyError(e);
  }
}

const first = (a?: AddressObject | AddressObject[]): Address => {
  const v = (Array.isArray(a) ? a[0] : a)?.value[0];
  return { name: v?.name ?? '', email: v?.address ?? '' };
};

const all = (a?: AddressObject | AddressObject[]): string[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((o) => o.value.map((v) => v.address ?? '')).filter(Boolean);

export class ImapProvider implements MailProvider {
  constructor(readonly account: Account) {}

  private async withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const { imap } = this.account;
    const password = passwords.get(this.account.id);
    if (!imap) throw new Error('This mailbox has no server settings. Remove and add it again.');
    if (!password) throw new Error('No password saved. Remove and add this mailbox again.');
    const client = imapClient(this.account.email, password, imap);
    try {
      await client.connect();
    } catch (e) {
      throw friendlyError(e);
    }
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  /** Runs `fn` with INBOX open, after checking that a message's UID is still valid. */
  private inInbox<T>(fn: (c: ImapFlow, uidValidity: string) => Promise<T>): Promise<T> {
    return this.withClient(async (c) => {
      const lock = await c.getMailboxLock('INBOX');
      try {
        const mailbox = c.mailbox;
        return await fn(c, mailbox ? String(mailbox.uidValidity) : '0');
      } finally {
        lock.release();
      }
    });
  }

  private uidOf(msg: EmailMessage, uidValidity: string): number {
    const [validity, uid] = msg.id.split('-');
    if (validity !== uidValidity) throw new Error('The mailbox changed on the server; this email can no longer be found.');
    return Number(uid);
  }

  private async specialFolder(c: ImapFlow, use: string, names: string[]): Promise<string | undefined> {
    const folders = await c.list();
    return (
      folders.find((f) => f.specialUse === use)?.path ??
      folders.find((f) => names.includes(f.name.toLowerCase()))?.path
    );
  }

  fetchSince(sinceMs: number, max: number): Promise<EmailMessage[]> {
    return this.inInbox(async (c, uidValidity) => {
      // IMAP SINCE has day granularity, so filter by the exact internal date below.
      const uids = (await c.search({ since: new Date(sinceMs) }, { uid: true })) || [];
      const pick = uids.slice(-max);
      const out: EmailMessage[] = [];
      if (!pick.length) return out;
      for await (const m of c.fetch(pick, { uid: true, source: true, internalDate: true, flags: true }, { uid: true })) {
        const receivedAt = m.internalDate ? new Date(m.internalDate).getTime() : Date.now();
        if (receivedAt < sinceMs || !m.source) continue;
        const msg = await this.parse(`${uidValidity}-${m.uid}`, m.source, receivedAt);
        msg.unread = m.flags ? !m.flags.has('\\Seen') : undefined;
        out.push(msg);
      }
      return out.sort((a, b) => b.receivedAt - a.receivedAt);
    });
  }

  private async parse(id: string, source: Buffer, receivedAt: number): Promise<EmailMessage> {
    const p = await simpleParser(source);
    const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
    // Raw header values: mailparser restructures List-* headers, but the raw line is what we parse.
    const header = (name: string) => {
      const line = p.headerLines.find((l) => l.key === name)?.line;
      return line?.slice(line.indexOf(':') + 1).replace(/\r?\n\s+/g, ' ').trim();
    };
    const text = p.text ?? (typeof p.html === 'string' ? htmlToText(p.html) : '');
    return {
      id,
      accountId: this.account.id,
      threadId: refs[0] ?? p.inReplyTo ?? p.messageId ?? id,
      from: first(p.from),
      replyTo: p.replyTo ? first(p.replyTo) : undefined,
      to: all(p.to),
      subject: p.subject ?? '',
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 200),
      body: cleanBody(text),
      receivedAt,
      webLink: this.account.webmailUrl ?? '',
      messageIdHeader: p.messageId,
      references: refs.join(' ') || undefined,
      isBulk: isBulkMail(header('list-unsubscribe'), header('precedence'), header('auto-submitted')),
      unsubscribe: parseListUnsubscribe(header('list-unsubscribe'), header('list-unsubscribe-post')),
    };
  }

  /** IMAP keywords: Thunderbird and Apple Mail show them; servers without keyword support refuse quietly. */
  label(msg: EmailMessage, category: Category): Promise<void> {
    return this.inInbox(async (c, uidValidity) => {
      await c.messageFlagsAdd(this.uidOf(msg, uidValidity), [`Pilot_${LABEL_NAMES[category]}`], { uid: true });
    });
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.deliver({ from: this.account.email, to, subject, text }, to);
  }

  private async deliver(mail: Mail.Options, to: string): Promise<Buffer> {
    const raw = await new MailComposer(mail).compile().build();
    const { smtp } = this.account;
    if (!smtp) throw new Error('This mailbox has no outgoing server settings.');
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure,
      auth: { user: this.account.email, pass: passwords.get(this.account.id) ?? '' },
    });
    try {
      await transport.sendMail({ envelope: { from: this.account.email, to }, raw });
    } catch (e) {
      throw friendlyError(e);
    }
    return raw;
  }

  async reply(msg: EmailMessage, text: string, send: boolean): Promise<void> {
    const mail: Mail.Options = {
      from: this.account.email,
      to: formatAddress(msg.replyTo ?? msg.from),
      subject: reSubject(msg.subject),
      text,
      inReplyTo: msg.messageIdHeader,
      references: [msg.references, msg.messageIdHeader].filter(Boolean).join(' ') || undefined,
    };
    const raw = send
      ? await this.deliver(mail, (msg.replyTo ?? msg.from).email)
      : await new MailComposer(mail).compile().build();
    if (send && this.account.saveSentCopy === false) return;

    await this.withClient(async (c) => {
      const folder = send
        ? await this.specialFolder(c, '\\Sent', ['sent', 'sent items', 'sent messages'])
        : await this.specialFolder(c, '\\Drafts', ['drafts', 'draft']);
      if (!folder) {
        if (send) return; // Sent fine; just no folder to file a copy in.
        throw new Error('This mailbox has no Drafts folder.');
      }
      await c.append(folder, raw, send ? ['\\Seen'] : ['\\Draft', '\\Seen']);
    });
  }

  /** Resolves with "archived:<uid>:<folder>" so the move can be undone (needs the server's UIDPLUS). */
  archive(msg: EmailMessage): Promise<string | void> {
    return this.inInbox(async (c, uidValidity) => {
      const folder = await this.specialFolder(c, '\\Archive', ['archive', 'archives']);
      if (!folder) throw new Error('This mailbox has no Archive folder.');
      const uid = this.uidOf(msg, uidValidity);
      const res = await c.messageMove(uid, folder, { uid: true });
      const newUid = res ? res.uidMap?.get(uid) : undefined;
      return newUid ? `archived:${newUid}:${folder}` : undefined;
    });
  }

  unarchive(msg: EmailMessage): Promise<string | void> {
    const m = msg.id.match(/^archived:(\d+):(.+)$/);
    if (!m) return Promise.reject(new Error("This server didn't report where it moved the email, so it can't be moved back automatically."));
    const [, uid, folder] = m;
    return this.withClient(async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        const res = await c.messageMove(Number(uid), 'INBOX', { uid: true });
        const status = await c.status('INBOX', { uidValidity: true });
        const newUid = res ? res.uidMap?.get(Number(uid)) : undefined;
        return newUid && status ? `${status.uidValidity}-${newUid}` : undefined;
      } finally {
        lock.release();
      }
    });
  }

  unlabel(msg: EmailMessage, category: Category): Promise<void> {
    return this.inInbox(async (c, uidValidity) => {
      await c.messageFlagsRemove(this.uidOf(msg, uidValidity), [`Pilot_${LABEL_NAMES[category]}`], { uid: true });
    });
  }

  markRead(msg: EmailMessage): Promise<void> {
    return this.inInbox(async (c, uidValidity) => {
      await c.messageFlagsAdd(this.uidOf(msg, uidValidity), ['\\Seen'], { uid: true });
    });
  }
}
