import type { Address, Category, EmailMessage, PdfFile, Settings } from '../../shared/types';
import { isPdf } from '../core/pdf';
import type { Interval } from '../core/slots';
import { oauthClients } from '../clients';
import { scopesFor, type Access } from '../core/access';
import type { OAuthConfig } from '../oauth';
import { OAuthProvider, type MailProvider } from './base';
import { cleanBody, htmlToText, isBulkMail, LABEL_NAMES, parseListUnsubscribe } from './mime';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const SELECT =
  'id,conversationId,subject,bodyPreview,body,receivedDateTime,webLink,from,replyTo,toRecipients,internetMessageId,internetMessageHeaders,isRead,hasAttachments';

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  conversationId: string;
  hasAttachments?: boolean;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime: string;
  webLink?: string;
  from?: GraphAddress;
  replyTo?: GraphAddress[];
  toRecipients?: GraphAddress[];
  internetMessageId?: string;
  isRead?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
}

export function microsoftOAuth(s: Settings, loginHint?: string, access: Access = 'full', calendar = false): OAuthConfig {
  const { microsoft } = oauthClients(s);
  if (!microsoft.clientId) {
    throw new Error('Microsoft sign-in is not set up in this copy of Inbox Pilot yet (oauth-clients.json is missing a Microsoft client).');
  }
  return {
    authUrl: `https://login.microsoftonline.com/${microsoft.tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${microsoft.tenant}/oauth2/v2.0/token`,
    clientId: microsoft.clientId,
    scopes: scopesFor('outlook', access, calendar),
    redirectHost: 'localhost',
    extraAuthParams: loginHint ? { login_hint: loginHint } : { prompt: 'select_account' },
  };
}

export async function outlookProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch(GRAPH, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Microsoft profile request failed (${res.status}).`);
  const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return me.mail ?? me.userPrincipalName ?? 'unknown';
}

const toAddress = (a?: GraphAddress): Address => ({
  name: a?.emailAddress?.name ?? '',
  email: a?.emailAddress?.address ?? '',
});

const textToHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

export class OutlookProvider extends OAuthProvider implements MailProvider {
  async fetchSince(sinceMs: number, max: number): Promise<EmailMessage[]> {
    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${new Date(sinceMs).toISOString()}`,
      $orderby: 'receivedDateTime desc',
      $top: String(max),
      $select: SELECT,
    });
    return (await this.pages(`${GRAPH}/mailFolders/inbox/messages?${params}`, max)).map((m) => this.parse(m));
  }

  /** Follows @odata.nextLink until `max` messages, so busy folders aren't cut off at one page. */
  private async pages(first: string, max: number): Promise<GraphMessage[]> {
    const out: GraphMessage[] = [];
    let url: string | undefined = first;
    while (url && out.length < max) {
      const res: { value: GraphMessage[]; '@odata.nextLink'?: string } = await this.api(url, {
        headers: { Prefer: 'outlook.body-content-type="text"' },
      });
      out.push(...res.value);
      url = res['@odata.nextLink'];
    }
    return out.slice(0, max);
  }

  async fetchSent(sinceMs: number, max: number): Promise<EmailMessage[]> {
    const params = new URLSearchParams({
      $filter: `sentDateTime ge ${new Date(sinceMs).toISOString()}`,
      $orderby: 'sentDateTime desc',
      $top: String(max),
      $select: SELECT,
    });
    return (await this.pages(`${GRAPH}/mailFolders/sentitems/messages?${params}`, max)).map((m) => this.parse(m));
  }

  /** /me/messages spans every folder, so this includes your replies in Sent Items. */
  async fetchThread(msg: EmailMessage): Promise<EmailMessage[]> {
    const params = new URLSearchParams({
      $filter: `conversationId eq '${msg.threadId.replace(/'/g, "''")}'`,
      $top: '25',
      $select: SELECT,
    });
    const res = await this.api<{ value: GraphMessage[] }>(`${GRAPH}/messages?${params}`, {
      headers: { Prefer: 'outlook.body-content-type="text"' },
    });
    return res.value.map((m) => this.parse(m));
  }

  private parse(m: GraphMessage): EmailMessage {
    const h = (name: string) => m.internetMessageHeaders?.find((x) => x.name.toLowerCase() === name)?.value;
    const content = m.body?.content ?? m.bodyPreview ?? '';
    return {
      id: m.id,
      accountId: this.account.id,
      threadId: m.conversationId,
      from: toAddress(m.from),
      replyTo: m.replyTo?.length ? toAddress(m.replyTo[0]) : undefined,
      to: (m.toRecipients ?? []).map((r) => toAddress(r).email).filter(Boolean),
      subject: m.subject ?? '',
      snippet: m.bodyPreview ?? '',
      body: cleanBody(m.body?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content),
      receivedAt: Date.parse(m.receivedDateTime) || Date.now(),
      webLink: m.webLink ?? 'https://outlook.office.com/mail/',
      unread: m.isRead === false,
      messageIdHeader: m.internetMessageId,
      isBulk: isBulkMail(h('list-unsubscribe'), h('precedence'), h('auto-submitted')),
      unsubscribe: parseListUnsubscribe(h('list-unsubscribe'), h('list-unsubscribe-post')),
      hasAttachments: m.hasAttachments || undefined,
    };
  }

  async fetchBusy(from: number, to: number): Promise<Interval[]> {
    const utc = (ms: number) => ({ dateTime: new Date(ms).toISOString().slice(0, 19), timeZone: 'UTC' });
    const r = await this.api<{ value?: { scheduleItems?: { status?: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(
      `${GRAPH}/calendar/getSchedule`,
      { method: 'POST', body: JSON.stringify({ schedules: [this.account.email], startTime: utc(from), endTime: utc(to), availabilityViewInterval: 30 }) },
    );
    return (r.value?.[0]?.scheduleItems ?? [])
      .filter((i) => i.status !== 'free')
      .map((i) => ({ start: Date.parse(`${i.start.dateTime}Z`), end: Date.parse(`${i.end.dateTime}Z`) }));
  }

  async fetchPdfs(msg: EmailMessage, max: number, maxBytes: number): Promise<PdfFile[]> {
    if (!msg.hasAttachments) return [];
    const list = await this.api<{ value?: { id: string; name?: string; contentType?: string; size?: number; '@odata.type'?: string }[] }>(
      `${GRAPH}/messages/${msg.id}/attachments?$select=id,name,contentType,size`,
    );
    const out: PdfFile[] = [];
    for (const a of (list.value ?? [])
      .filter((x) => x['@odata.type'] === '#microsoft.graph.fileAttachment' && isPdf(x.name ?? '', x.contentType ?? '') && (x.size ?? 0) <= maxBytes)
      .slice(0, max)) {
      const f = await this.api<{ contentBytes?: string }>(`${GRAPH}/messages/${msg.id}/attachments/${a.id}`);
      if (f.contentBytes) out.push({ name: a.name ?? 'attachment.pdf', data: Buffer.from(f.contentBytes, 'base64') });
    }
    return out;
  }

  async reply(msg: EmailMessage, text: string, send: boolean, opts: { all?: boolean } = {}): Promise<void> {
    // `comment` is placed above the quoted original, keeping the thread intact.
    const body = JSON.stringify({ comment: textToHtml(text) });
    const action = opts.all ? (send ? 'replyAll' : 'createReplyAll') : send ? 'reply' : 'createReply';
    await this.api(`${GRAPH}/messages/${msg.id}/${action}`, { method: 'POST', body });
  }

  /** Graph gives a moved message a new id, so return it for later undo. */
  async archive(msg: EmailMessage): Promise<string> {
    return this.move(msg.id, 'archive');
  }

  async unarchive(msg: EmailMessage): Promise<string> {
    return this.move(msg.id, 'inbox');
  }

  private async move(id: string, destinationId: string): Promise<string> {
    const moved = await this.api<{ id: string }>(`${GRAPH}/messages/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    });
    return moved.id;
  }

  async unlabel(msg: EmailMessage, category: Category): Promise<void> {
    const name = `Pilot: ${LABEL_NAMES[category]}`;
    const { categories = [] } = await this.api<{ categories?: string[] }>(`${GRAPH}/messages/${msg.id}?$select=categories`);
    if (!categories.includes(name)) return;
    await this.api(`${GRAPH}/messages/${msg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categories: categories.filter((c) => c !== name) }),
    });
  }

  async markRead(msg: EmailMessage): Promise<void> {
    await this.api(`${GRAPH}/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) });
  }

  /** Outlook categories show as coloured tags; keep any the user already set. */
  async label(msg: EmailMessage, category: Category): Promise<void> {
    const name = `Pilot: ${LABEL_NAMES[category]}`;
    const { categories = [] } = await this.api<{ categories?: string[] }>(`${GRAPH}/messages/${msg.id}?$select=categories`);
    if (categories.includes(name)) return;
    await this.api(`${GRAPH}/messages/${msg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categories: [...categories, name] }),
    });
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.api(`${GRAPH}/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
  }
}
