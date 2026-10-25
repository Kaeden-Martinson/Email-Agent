import type { AttachmentInfo, Category, EmailMessage, PdfFile, Settings } from '../../shared/types';
import { isPdf } from '../core/pdf';
import type { Interval } from '../core/slots';
import { oauthClients } from '../clients';
import { scopesFor, type Access } from '../core/access';
import type { OAuthConfig } from '../oauth';
import { OAuthProvider, type MailProvider } from './base';
import {
  buildReplyMime,
  cleanBody,
  decodeEntities,
  formatAddress,
  htmlToText,
  isBulkMail,
  LABEL_NAMES,
  parseAddress,
  parseListUnsubscribe,
  reSubject,
  splitAddresses,
} from './mime';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Label name -> id, per account, so labels are looked up once per session. */
const labelIds = new Map<string, Map<string, string>>();

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export function googleOAuth(s: Settings, loginHint?: string, access: Access = 'full', calendar = false): OAuthConfig {
  const { google } = oauthClients(s);
  if (!google.clientId) {
    throw new Error('Google sign-in is not set up in this copy of Lodestar yet (oauth-clients.json is missing a Google client).');
  }
  return {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: google.clientId,
    clientSecret: google.clientSecret || undefined,
    scopes: scopesFor('gmail', access, calendar),
    redirectHost: '127.0.0.1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', ...(loginHint ? { login_hint: loginHint } : {}) },
  };
}

export async function gmailProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch(`${BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail profile request failed (${res.status}). Is the Gmail API enabled?`);
  return ((await res.json()) as { emailAddress: string }).emailAddress;
}

/** Files attached to the message (parts with a filename and a downloadable body). */
function attachmentsOf(root: GmailPart | undefined): { attachments?: AttachmentInfo[]; hasAttachments?: boolean } {
  const out: AttachmentInfo[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename && p.body?.attachmentId) out.push({ id: p.body.attachmentId, name: p.filename, mimeType: p.mimeType ?? '', size: p.body.size ?? 0 });
    for (const c of p.parts ?? []) walk(c);
  };
  if (root) walk(root);
  return out.length ? { attachments: out.slice(0, 20), hasAttachments: true } : {};
}

function findBody(part: GmailPart, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const p of part.parts ?? []) {
    const found = findBody(p, mimeType);
    if (found) return found;
  }
  return undefined;
}

export class GmailProvider extends OAuthProvider implements MailProvider {
  fetchSince(sinceMs: number, max: number): Promise<EmailMessage[]> {
    return this.search(`in:inbox after:${Math.floor(sinceMs / 1000)}`, max);
  }

  fetchSent(sinceMs: number, max: number): Promise<EmailMessage[]> {
    return this.search(`in:sent after:${Math.floor(sinceMs / 1000)}`, max);
  }

  private async search(q: string, max: number): Promise<EmailMessage[]> {
    // Page through results up to `max`, so a busy inbox isn't cut off at the first page.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) params.set('pageToken', pageToken);
      const list = await this.api<{ messages?: { id: string }[]; nextPageToken?: string }>(`${BASE}/messages?${params}`);
      ids.push(...(list.messages ?? []).map((m) => m.id));
      pageToken = list.nextPageToken;
    } while (pageToken && ids.length < max);
    // A few requests at a time: much faster than one by one, gentle on Gmail's rate limits.
    const out: EmailMessage[] = new Array(ids.length);
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        out[i] = this.parse(await this.api<GmailMessage>(`${BASE}/messages/${ids[i]}?format=full`));
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));
    return out;
  }

  async fetchThread(msg: EmailMessage): Promise<EmailMessage[]> {
    const t = await this.api<{ messages?: GmailMessage[] }>(`${BASE}/threads/${msg.threadId}?format=full`);
    return (t.messages ?? []).map((m) => this.parse(m));
  }

  private parse(m: GmailMessage): EmailMessage {
    const headers = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name)?.value;
    const plain = m.payload && findBody(m.payload, 'text/plain');
    const html = !plain && m.payload ? findBody(m.payload, 'text/html') : undefined;
    const replyTo = h('reply-to');
    return {
      id: m.id,
      accountId: this.account.id,
      threadId: m.threadId,
      from: parseAddress(h('from') ?? ''),
      replyTo: replyTo ? parseAddress(replyTo) : undefined,
      to: splitAddresses(h('to') ?? ''),
      subject: h('subject') ?? '',
      snippet: decodeEntities(m.snippet ?? ''),
      body: cleanBody(plain ?? (html ? htmlToText(html) : decodeEntities(m.snippet ?? ''))),
      receivedAt: Number(m.internalDate) || Date.now(),
      webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(this.account.email)}#all/${m.id}`,
      unread: m.labelIds?.includes('UNREAD'),
      messageIdHeader: h('message-id'),
      references: h('references'),
      isBulk: isBulkMail(h('list-unsubscribe'), h('precedence'), h('auto-submitted')),
      unsubscribe: parseListUnsubscribe(h('list-unsubscribe'), h('list-unsubscribe-post')),
      ...attachmentsOf(m.payload),
    };
  }

  async fetchBusy(from: number, to: number): Promise<Interval[]> {
    try {
      const r = await this.api<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        { method: 'POST', body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: 'primary' }] }) },
      );
      return (r.calendars?.primary?.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) {
        throw new Error('The Google Calendar API is turned off in your Google Cloud project. Enable it at console.cloud.google.com → APIs & Services → Library → Google Calendar API.');
      }
      if (/insufficient|scope|403/i.test(msg)) throw new Error('Lodestar has no calendar access for this mailbox. Use Connect calendar on the Mailboxes page.');
      throw e;
    }
  }

  async fetchPdfs(msg: EmailMessage, max: number, maxBytes: number): Promise<PdfFile[]> {
    const out: PdfFile[] = [];
    for (const a of (msg.attachments ?? []).filter((x) => isPdf(x.name, x.mimeType) && x.size <= maxBytes).slice(0, max)) {
      const r = await this.api<{ data?: string }>(`${BASE}/messages/${msg.id}/attachments/${a.id}`);
      if (r.data) out.push({ name: a.name, data: Buffer.from(r.data, 'base64url') });
    }
    return out;
  }

  async reply(msg: EmailMessage, text: string, send: boolean): Promise<void> {
    const raw = buildReplyMime({
      from: this.account.email,
      to: formatAddress(msg.replyTo ?? msg.from),
      subject: reSubject(msg.subject),
      inReplyTo: msg.messageIdHeader,
      references: [msg.references, msg.messageIdHeader].filter(Boolean).join(' ') || undefined,
      text,
    });
    const message = { raw, threadId: msg.threadId };
    if (send) {
      await this.api(`${BASE}/messages/send`, { method: 'POST', body: JSON.stringify(message) });
    } else {
      await this.api(`${BASE}/drafts`, { method: 'POST', body: JSON.stringify({ message }) });
    }
  }

  async archive(msg: EmailMessage): Promise<void> {
    await this.modify(msg.id, ['INBOX']);
  }

  async unarchive(msg: EmailMessage): Promise<void> {
    await this.api(`${BASE}/messages/${msg.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: ['INBOX'] }) });
  }

  async unlabel(msg: EmailMessage, category: Category): Promise<void> {
    const id = await this.labelId(`Pilot/${LABEL_NAMES[category]}`);
    await this.modify(msg.id, [id]);
  }

  async markRead(msg: EmailMessage): Promise<void> {
    await this.modify(msg.id, ['UNREAD']);
  }

  async label(msg: EmailMessage, category: Category): Promise<void> {
    const id = await this.labelId(`Pilot/${LABEL_NAMES[category]}`);
    await this.api(`${BASE}/messages/${msg.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [id] }) });
  }

  private async labelId(name: string): Promise<string> {
    let cache = labelIds.get(this.account.id);
    if (!cache) {
      const { labels } = await this.api<{ labels?: { id: string; name: string }[] }>(`${BASE}/labels`);
      cache = new Map((labels ?? []).map((l) => [l.name, l.id]));
      labelIds.set(this.account.id, cache);
    }
    let id = cache.get(name);
    if (!id) {
      ({ id } = await this.api<{ id: string }>(`${BASE}/labels`, {
        method: 'POST',
        body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
      }));
      cache.set(name, id);
    }
    return id;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    const raw = buildReplyMime({ from: this.account.email, to, subject, text });
    await this.api(`${BASE}/messages/send`, { method: 'POST', body: JSON.stringify({ raw }) });
  }

  private async modify(id: string, removeLabelIds: string[]): Promise<void> {
    await this.api(`${BASE}/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds }) });
  }
}
