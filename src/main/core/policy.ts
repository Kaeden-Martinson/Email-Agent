// Hard safety rules for automation. Pure functions with no Electron or network access, so they can be
// unit-tested. Nothing here consults the AI: an email cannot talk its way past these checks.
import { NEVER_REPLY, type Account, type Subscription, type Update } from '../../shared/types';

export const NO_REPLY_SENDER = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?@)/i;

/** Automatic unsubscribe only after this many newsletters/promos from one sender in 30 days. */
export const AUTO_UNSUBSCRIBE_AFTER = 3;

export const replyAddress = (u: Update) => (u.message.replyTo ?? u.message.from).email.toLowerCase();

/** Why Lodestar must not reply to this email automatically, or undefined if it may. */
export function replyBlocker(u: Update, account: Account, repliedThreads: readonly string[]): string | undefined {
  const m = u.message;
  const sender = replyAddress(u);
  if (!sender) return 'No sender address';
  if (sender === account.email.toLowerCase()) return 'Sent by you';
  if (NO_REPLY_SENDER.test(sender)) return 'No-reply or automated sender';
  if (m.isBulk) return 'Mailing-list or bulk mail';
  if (u.triage && NEVER_REPLY.includes(u.triage.category)) return `Category "${u.triage.category}" is never auto-replied`;
  if (repliedThreads.includes(`${account.id}:${m.threadId}`)) return 'Already replied in this thread';
  return undefined;
}

/** Exact address match, or "@domain" matching that domain exactly (not look-alike domains). */
export function senderTrusted(sender: string, trusted: readonly string[]): boolean {
  const s = sender.trim().toLowerCase();
  return trusted.some((rule) => {
    const r = rule.trim().toLowerCase();
    if (!r) return false;
    return r.startsWith('@') ? s.endsWith(r) && s.indexOf('@') === s.length - r.length : r === s;
  });
}

export type ReplyDecision =
  | { kind: 'none' }
  | { kind: 'skip'; reason: string }
  | { kind: 'reply'; send: boolean; note?: string };

/** What the auto-reply step may do with this email, given the mailbox's permissions. */
export function decideAutoReply(
  u: Update,
  account: Account,
  opts: { categories: readonly string[]; repliedThreads: readonly string[]; sentLast24h: number; dailySendCap: number },
): ReplyDecision {
  const mode = account.permissions.replies;
  const t = u.triage;
  if (mode === 'off' || !t?.needsReply || !t.draftReply || u.reply) return { kind: 'none' };
  if (!opts.categories.includes(t.category)) return { kind: 'none' };
  const blocker = replyBlocker(u, account, opts.repliedThreads);
  if (blocker) return { kind: 'skip', reason: blocker };
  if (mode === 'draft') return { kind: 'reply', send: false };
  const trusted = senderTrusted(replyAddress(u), account.permissions.trustedSenders);
  const underCap = opts.sentLast24h < opts.dailySendCap;
  if (trusted && underCap) return { kind: 'reply', send: true };
  return {
    kind: 'reply',
    send: false,
    note: trusted
      ? 'Saved as a draft because the daily send limit was reached'
      : 'Saved as a draft because the sender is not on your trusted list',
  };
}

/** Auto-archive never touches urgent mail or mail someone is waiting on. */
export function shouldAutoArchive(u: Update, account: Account): boolean {
  const t = u.triage;
  const p = account.permissions;
  return !!t && p.manage && p.autoClean.includes(t.category) && t.priority !== 1 && !t.needsReply;
}

/** Automatic unsubscribe only via RFC 8058 one-click, and only for repeat senders. */
export function autoUnsubscribeEligible(sub: Subscription | undefined): boolean {
  return !!sub && !sub.unsubscribedAt && !!sub.unsubscribe?.oneClick && !!sub.unsubscribe.url && sub.count >= AUTO_UNSUBSCRIBE_AFTER;
}

export function composeReply(text: string, signature: string, autoSent: boolean, disclose: boolean): string {
  let out = text.trim();
  if (signature.trim()) out += `\n\n${signature.trim()}`;
  if (autoSent && disclose) out += '\n\n(Sent automatically by my email assistant.)';
  return out;
}
