import type { Account, Category, EmailMessage, PdfFile } from '../../shared/types';
import { refresh, type OAuthConfig } from '../oauth';
import { withRetry } from '../core/retry';
import type { Interval } from '../core/slots';
import { tokens } from '../secrets';

export interface MailProvider {
  readonly account: Account;
  /** Inbox messages received at or after `sinceMs`, newest first. */
  fetchSince(sinceMs: number, max: number): Promise<EmailMessage[]>;
  /** Every message in this message's conversation the provider can find, including ones you sent. */
  fetchThread(msg: EmailMessage): Promise<EmailMessage[]>;
  /** Messages you sent at or after `sinceMs`, newest first. */
  fetchSent(sinceMs: number, max: number): Promise<EmailMessage[]>;
  /** Replies in-thread; `send: false` saves a draft instead. `all` replies to every recipient (for nudging your own sent mail). */
  reply(msg: EmailMessage, text: string, send: boolean, opts?: { all?: boolean }): Promise<void>;
  /** Moves out of the inbox. Resolves with the message's new id when the provider changes it (Outlook, IMAP). */
  archive(msg: EmailMessage): Promise<string | void>;
  /** Moves back to the inbox; resolves with the new id when it changes. */
  unarchive(msg: EmailMessage): Promise<string | void>;
  markRead(msg: EmailMessage): Promise<void>;
  /** Tags the message in the mailbox (label, category or keyword). */
  label(msg: EmailMessage, category: Category): Promise<void>;
  unlabel(msg: EmailMessage, category: Category): Promise<void>;
  /** Downloads up to `max` PDF attachments no larger than `maxBytes` each. Read-only. */
  fetchPdfs(msg: EmailMessage, max: number, maxBytes: number): Promise<PdfFile[]>;
  /** Busy times on the main calendar (free/busy only). Only Gmail and Outlook with calendar access. */
  fetchBusy?(from: number, to: number): Promise<Interval[]>;
  /** Sends a new plain-text email (used for mailto: unsubscribes). */
  send(to: string, subject: string, text: string): Promise<void>;
}

/** One refresh at a time per account: parallel requests share it (Microsoft rotates refresh tokens). */
const refreshing = new Map<string, Promise<string>>();

/** Bearer-token REST calls with automatic token refresh and polite retries. */
export abstract class OAuthProvider {
  constructor(
    readonly account: Account,
    protected readonly oauth: OAuthConfig,
  ) {}

  protected async token(force = false): Promise<string> {
    const t = tokens.get(this.account.id);
    if (!t) throw new Error('Not signed in. Use Reconnect on the Mailboxes page.');
    if (!force && t.expiresAt - 60_000 >= Date.now()) return t.accessToken;
    if (!t.refreshToken) throw new Error('Session expired. Use Reconnect on the Mailboxes page.');
    let pending = refreshing.get(this.account.id);
    if (!pending) {
      pending = refresh(this.oauth, t.refreshToken)
        .then((fresh) => {
          tokens.set(this.account.id, fresh);
          return fresh.accessToken;
        })
        .catch((e: Error) => {
          if (/invalid_grant|expired|revoked/i.test(e.message)) {
            throw new Error(
              this.account.kind === 'gmail'
                ? 'Google ended this sign-in (while the app is in Testing, Google does this every 7 days). Use Reconnect on the Mailboxes page; nothing is lost.'
                : 'The sign-in for this mailbox expired or was revoked. Use Reconnect on the Mailboxes page; nothing is lost.',
            );
          }
          throw e;
        })
        .finally(() => refreshing.delete(this.account.id));
      refreshing.set(this.account.id, pending);
    }
    return pending;
  }

  protected async api<T>(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
    const call = async (force: boolean) => {
      const auth = `Bearer ${await this.token(force)}`;
      return withRetry(() =>
        fetch(url, {
          ...init,
          headers: { Authorization: auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
          signal: AbortSignal.timeout(60_000),
        }),
      );
    };
    let res = await call(false);
    // An access token can be revoked before it expires: refresh once and retry.
    if (res.status === 401) res = await call(true);
    if (!res.ok) {
      throw new Error(`${this.account.kind} API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
