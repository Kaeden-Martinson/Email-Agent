// Free meeting times from calendar busy blocks, for reply drafts. Pure, so it's tested without a calendar.
// Pilot only offers these times in drafts you review; it never accepts or books anything.

export interface Interval {
  start: number;
  end: number;
}

export interface SlotOptions {
  /** Working days to look ahead. */
  days: number;
  startHour: number;
  endHour: number;
  /** Shortest useful gap. */
  minMinutes: number;
  /** Longest slot offered (a long free afternoon is offered as one hour). */
  maxMinutes: number;
  /** How many slots to return; spread over different days. */
  count: number;
  /** Don't offer anything sooner than this. */
  leadMinutes: number;
}

export const DEFAULT_SLOTS: SlotOptions = { days: 5, startHour: 9, endHour: 17, minMinutes: 30, maxMinutes: 60, count: 3, leadMinutes: 120 };

const MIN = 60_000;

/** Free windows inside working hours (local time), at most one per day, earliest first. */
export function freeSlots(busy: readonly Interval[], now: Date, o: SlotOptions = DEFAULT_SLOTS): Interval[] {
  const blocks = [...busy].filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const earliest = roundUp(now.getTime() + o.leadMinutes * MIN, 30);
  const out: Interval[] = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let workdays = 0;
  for (let i = 0; i < 21 && workdays < o.days && out.length < o.count; i++, day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    workdays++;
    const open = new Date(day);
    open.setHours(o.startHour, 0, 0, 0);
    const close = new Date(day);
    close.setHours(o.endHour, 0, 0, 0);
    let cursor = Math.max(open.getTime(), earliest);
    for (const b of [...blocks.filter((x) => x.end > cursor && x.start < close.getTime()), { start: close.getTime(), end: close.getTime() }]) {
      const gapEnd = Math.min(b.start, close.getTime());
      if (gapEnd - cursor >= o.minMinutes * MIN) {
        out.push({ start: cursor, end: Math.min(gapEnd, cursor + o.maxMinutes * MIN) });
        break;
      }
      cursor = Math.max(cursor, roundUp(b.end, 30));
      if (cursor >= close.getTime()) break;
    }
  }
  return out;
}

function roundUp(ms: number, minutes: number): number {
  const step = minutes * MIN;
  return Math.ceil(ms / step) * step;
}

/** "Tuesday, Oct 27, 10:00–11:00 AM" in the PC's locale and time zone. */
export function formatSlot(s: Interval, locale?: string): string {
  const d = new Date(s.start);
  const date = d.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });
  const t = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${t(s.start)}–${t(s.end)}`;
}

/** The email asks to find a time: a meeting, call or availability. */
export function asksForTime(text: string): boolean {
  return /\b(meet(?:ing)?|call|catch up|chat|available|availability|free (?:to|on|at|this|next|for)|schedule|reschedule|times? (?:that )?works?|a time|find time|zoom|google meet|teams call|coffee|hop on|sync up)\b/i.test(text);
}
