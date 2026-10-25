// Least privilege: which OAuth scopes each connection mode requests, and which actions each mode allows.
// Checked in code before every mailbox write, independent of what the UI shows.
import type { Account, ActivityAction, ProviderKind } from '../../shared/types';

export type Access = 'full' | 'readonly';

/**
 * `calendar` adds free/busy access only: when you're busy, never event titles, people or details
 * (Microsoft's narrowest equivalent, Calendars.ReadBasic, excludes bodies and attendees).
 */
export function scopesFor(kind: Exclude<ProviderKind, 'imap'>, access: Access, calendar = false): string[] {
  if (kind === 'gmail') {
    return [
      access === 'readonly'
        ? 'https://www.googleapis.com/auth/gmail.readonly'
        : // gmail.modify covers read, labels/archive, drafts and send; nothing broader (no delete-forever).
          'https://www.googleapis.com/auth/gmail.modify',
      ...(calendar ? ['https://www.googleapis.com/auth/calendar.freebusy'] : []),
    ];
  }
  return [
    ...(access === 'readonly' ? ['offline_access', 'User.Read', 'Mail.Read'] : ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send']),
    ...(calendar ? ['Calendars.ReadBasic'] : []),
  ];
}

/** Actions that change the mailbox (or send mail from it). */
const WRITES: ActivityAction[] = ['archive', 'label', 'draft', 'send'];

/** Why this mailbox may not do the action, or undefined when allowed. */
export function accessBlocker(account: Pick<Account, 'access' | 'email'>, action: ActivityAction | 'unsubscribe-email'): string | undefined {
  if (account.access !== 'readonly') return undefined;
  if (WRITES.includes(action as ActivityAction) || action === 'unsubscribe-email') {
    return `${account.email} is connected read-only, so Lodestar can't change it or send from it. Reconnect it with full access to allow this.`;
  }
  return undefined;
}
