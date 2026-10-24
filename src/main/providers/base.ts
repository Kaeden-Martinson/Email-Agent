import type { Account, Category, EmailMessage } from '../../shared/types';
import { refresh, type OAuthConfig } from '../oauth';
import { tokens } from '../secrets';

export interface MailProvider {
  readonly account: Account;
  /** Inbox messages received at or after `sinceMs`, newest first. */
  fetchSince(sinceMs: number, max: number): Promise<EmailMessage[]>;
  /** Replies in-thread; `send: false` saves a draft instead. */
  reply(msg: EmailMessage, text: string, send: boolean): Promise<void>;
  /** Moves out of the inbox. Resolves with the message's new id when the provider changes it (Outlook, IMAP). */
  archive(msg: EmailMessage): Promise<string | void>;
  /** Moves back to the inbox; resolves with the new id when it changes. */
  unarchive(msg: EmailMessage): Promise<string | void>;
  markRead(msg: EmailMessage): Promise<void>;
  /** Tags the message in the mailbox (label, category or keyword). */
  label(msg: EmailMessage, category: Category): Promise<void>;
  unlabel(msg: EmailMessage, category: Category): Promise<void>;
  /** Sends a new plain-text email (used for mailto: unsubscribes). */
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Bearer-token REST calls with automatic token refresh. */
export abstract class OAuthProvider {
  constructor(
    readonly account: Account,
    protected readonly oauth: OAuthConfig,
  ) {}

  protected async token(): Promise<string> {
    let t = tokens.get(this.account.id);
    if (!t) throw new Error('Not signed in. Remove and reconnect this account.');
    if (t.expiresAt - 60_000 < Date.now()) {
      if (!t.refreshToken) throw new Error('Session expired. Remove and reconnect this account.');
      t = await refresh(this.oauth, t.refreshToken);
      tokens.set(this.account.id, t);
    }
    return t.accessToken;
  }

  protected async api<T>(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`${this.account.kind} API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
