import type { Address, Category, EmailMessage, Settings } from '../../shared/types';
import { oauthClients } from '../clients';
import type { OAuthConfig } from '../oauth';
import { OAuthProvider, type MailProvider } from './base';
import { cleanBody, htmlToText, isBulkMail, LABEL_NAMES, parseListUnsubscribe } from './mime';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  conversationId: string;
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

export function microsoftOAuth(s: Settings, loginHint?: string): OAuthConfig {
  const { microsoft } = oauthClients(s);
  if (!microsoft.clientId) {
    throw new Error('Microsoft sign-in is not set up in this copy of Inbox Pilot yet (oauth-clients.json is missing a Microsoft client).');
  }
  return {
    authUrl: `https://login.microsoftonline.com/${microsoft.tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${microsoft.tenant}/oauth2/v2.0/token`,
    clientId: microsoft.clientId,
    scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'],
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
      $select:
        'id,conversationId,subject,bodyPreview,body,receivedDateTime,webLink,from,replyTo,toRecipients,internetMessageId,internetMessageHeaders,isRead',
    });
    const res = await this.api<{ value: GraphMessage[] }>(`${GRAPH}/mailFolders/inbox/messages?${params}`, {
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
    };
  }

  async reply(msg: EmailMessage, text: string, send: boolean): Promise<void> {
    // `comment` is placed above the quoted original, keeping the thread intact.
    const body = JSON.stringify({ comment: textToHtml(text) });
    await this.api(`${GRAPH}/messages/${msg.id}/${send ? 'reply' : 'createReply'}`, { method: 'POST', body });
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
