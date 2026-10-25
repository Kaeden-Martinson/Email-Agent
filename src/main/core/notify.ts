// What a notification says at each privacy level, and when it may be delivered. Pure and tested:
// "minimal" must never reveal who wrote, what about, or any amount.
import type { NotifyEvent, PrivacyLevel } from '../../shared/types';

export interface NoteInput {
  event: NotifyEvent;
  /** Stable id for de-duplication, e.g. "urgent:<email key>". */
  key: string;
  sender?: string;
  subject?: string;
  /** Summary or detail; only shown at "full". */
  detail?: string;
  /** For counts: "3 actions waiting". */
  count?: number;
  /** Count-only text that is safe at every level (used for briefings below "full"). */
  safe?: string;
}

export interface Formatted {
  title: string;
  body: string;
}

const MINIMAL: Record<NotifyEvent, (n: NoteInput) => string> = {
  urgent: () => 'You have an important new email.',
  reminder: () => 'You have a reminder due.',
  briefing: (n) => n.safe ?? 'Your morning briefing is ready.',
  deadline: () => 'A bill or deadline is coming up.',
  followup: () => "It's time to follow up on an email you sent.",
  reply: () => "Someone replied to an email you were waiting on.",
  approval: (n) => `${n.count ?? 1} action${(n.count ?? 1) === 1 ? ' is' : 's are'} waiting for your approval.`,
};

const TITLE: Record<NotifyEvent, string> = {
  urgent: 'Important email',
  reminder: 'Reminder',
  briefing: 'Morning briefing',
  deadline: 'Coming up',
  followup: 'Time to follow up',
  reply: 'Reply received',
  approval: 'Approval needed',
};

/**
 * The text of a notification. "minimal" shows only that something happened; "sender" adds who and the
 * subject; "full" adds the summary. Amounts and summaries never appear below "full".
 */
export function formatNote(n: NoteInput, level: PrivacyLevel): Formatted {
  const title = `Lodestar · ${TITLE[n.event]}`;
  if (level === 'minimal' || (!n.sender && !n.subject && !n.detail)) return { title, body: MINIMAL[n.event](n) };
  const who = [n.sender, n.subject && `"${n.subject}"`].filter(Boolean).join(' · ');
  if (level === 'sender') {
    if (n.event === 'briefing' || n.event === 'approval') return { title, body: MINIMAL[n.event](n) };
    return { title, body: who || MINIMAL[n.event](n) };
  }
  const body = [who, n.detail].filter(Boolean).join('\n');
  return { title, body: body || MINIMAL[n.event](n) };
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Inside quiet hours? Handles ranges across midnight (22:00–07:00). */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** One message for everything held during quiet hours or over the rate limit. */
export function summarizeHeld(held: readonly NoteInput[]): Formatted | undefined {
  if (!held.length) return undefined;
  const counts = new Map<NotifyEvent, number>();
  for (const n of held) counts.set(n.event, (counts.get(n.event) ?? 0) + 1);
  const label: Record<NotifyEvent, [string, string]> = {
    urgent: ['important email', 'important emails'],
    reminder: ['reminder', 'reminders'],
    briefing: ['briefing', 'briefings'],
    deadline: ['upcoming deadline', 'upcoming deadlines'],
    followup: ['follow-up due', 'follow-ups due'],
    reply: ['reply received', 'replies received'],
    approval: ['approval request', 'approval requests'],
  };
  const parts = [...counts.entries()].map(([e, c]) => `${c} ${label[e][c === 1 ? 0 : 1]}`);
  return { title: 'Lodestar · While you were away', body: `${parts.join(', ')}. Open Lodestar for details.` };
}
