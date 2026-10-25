// The weekly digest: what came in last week, what Lodestar and you did, and what's coming up.
// Pure and count-based, so it's tested and safe to show anywhere.
import type { ActivityEntry, FollowUp, KeyItem, Update, WeeklyDigest } from '../../shared/types';

const DAY = 86_400_000;

export interface DigestInput {
  updates: readonly Update[];
  activity: readonly ActivityEntry[];
  items: readonly KeyItem[];
  followUps: readonly FollowUp[];
  owed: number;
}

export function weeklyDigest(d: DigestInput, now = Date.now()): WeeklyDigest {
  const since = now - 7 * DAY;
  const week = d.updates.filter((u) => u.message.receivedAt >= since);
  const important = week.filter((u) => u.triage?.priority === 1).length;
  const done = d.activity.filter((a) => a.at >= since && a.status === 'done');
  const autoActions = done.filter((a) => a.trigger === 'auto').length;
  const repliesSent = done.filter((a) => a.action === 'send').length;
  const archived = done.filter((a) => a.action === 'archive').length;

  const horizon = now + 14 * DAY;
  const coming = d.items.filter((i) => i.status === 'open' && i.at !== undefined && i.at >= now - DAY && i.at <= horizon);
  const bills = coming.filter((i) => i.kind === 'bill');
  // Totals only add up amounts in one currency; mixed currencies are listed as a count.
  const currencies = new Set(bills.filter((b) => b.amount).map((b) => b.currency || 'USD'));
  const billTotal = currencies.size === 1 ? bills.reduce((n, b) => n + (b.amount ?? 0), 0) : undefined;
  const currency = currencies.size === 1 ? [...currencies][0] : undefined;
  const deadlines = coming.length - bills.length;
  const waitingOn = d.followUps.filter((f) => f.status === 'waiting').length;

  const bySender = new Map<string, number>();
  for (const u of week) {
    if (u.triage && ['newsletter', 'promo', 'notification'].includes(u.triage.category)) {
      const k = u.message.from.name || u.message.from.email;
      bySender.set(k, (bySender.get(k) ?? 0) + 1);
    }
  }
  const noisiest = [...bySender].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 3).slice(0, 3).map(([name, count]) => ({ name, count }));

  return { at: now, received: week.length, important, autoActions, repliesSent, archived, bills: bills.length, billTotal, currency, deadlines, waitingOn, owed: d.owed, noisiest };
}

/** Counts only: safe for phone notifications at every privacy level. */
export function digestSummary(w: WeeklyDigest): string {
  const parts = [
    `${w.received} email${w.received === 1 ? '' : 's'} last week (${w.important} important)`,
    w.autoActions ? `${w.autoActions} handled automatically` : '',
    w.bills || w.deadlines ? `${w.bills} bill${w.bills === 1 ? '' : 's'} and ${w.deadlines} deadline${w.deadlines === 1 ? '' : 's'} in the next 2 weeks` : '',
    w.owed ? `${w.owed} repl${w.owed === 1 ? 'y' : 'ies'} you owe` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
