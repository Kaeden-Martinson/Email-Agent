import type { Account, EmailMessage, Settings } from '../../shared/types';
import { authorize } from '../oauth';
import type { TokenSet } from '../secrets';
import type { MailProvider } from './base';
import { gmailProfileEmail, GmailProvider, googleOAuth } from './gmail';
import { ImapProvider } from './imap';
import { microsoftOAuth, OutlookProvider, outlookProfileEmail } from './outlook';

export type { MailProvider } from './base';
export { discover } from './discovery';
export { verifyImap } from './imap';

/** Runs the browser sign-in and returns the address that actually signed in, plus tokens. */
export async function signIn(
  kind: 'gmail' | 'outlook',
  s: Settings,
  loginHint?: string,
): Promise<{ email: string; tokenSet: TokenSet }> {
  if (kind === 'gmail') {
    const tokenSet = await authorize(googleOAuth(s, loginHint));
    return { email: await gmailProfileEmail(tokenSet.accessToken), tokenSet };
  }
  const tokenSet = await authorize(microsoftOAuth(s, loginHint));
  return { email: await outlookProfileEmail(tokenSet.accessToken), tokenSet };
}

export function createProvider(account: Account, s: Settings): MailProvider {
  if (account.id.startsWith('demo')) return new DemoProvider(account);
  switch (account.kind) {
    case 'gmail':
      return new GmailProvider(account, googleOAuth(s));
    case 'outlook':
      return new OutlookProvider(account, microsoftOAuth(s));
    case 'imap':
      return new ImapProvider(account);
  }
}

/** Used by --demo: no network, every action succeeds. */
class DemoProvider implements MailProvider {
  constructor(readonly account: Account) {}
  async fetchSince(): Promise<EmailMessage[]> {
    return [];
  }
  async reply(): Promise<void> {}
  async archive(): Promise<void> {}
  async unarchive(): Promise<void> {}
  async unlabel(): Promise<void> {}
  async markRead(): Promise<void> {}
  async label(): Promise<void> {}
  async send(): Promise<void> {}
}
