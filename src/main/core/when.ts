// Natural-language times for reminders and deadlines: "Friday", "tomorrow at 3pm", "in 2 days",
// "Nov 3", "end of week", "remind me Friday if they haven't replied". Deterministic and local-time,
// so the result can be shown to the user before it is saved.

export interface When {
  at: number;
  /** "…if they haven't replied": cancel the reminder when a reply arrives. */
  unlessReplied: boolean;
}

export type WhenResult = When | { error: string };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

const UNLESS_REPLIED =
  /\b(?:if|unless)\s+(?:they|he|she|nobody|no one|no-one|i|we|there(?:'s| is))?\s*(?:still\s+)?(?:haven'?t|hasn'?t|have not|has not|don'?t|doesn'?t|didn'?t|not)?\s*(?:been\s+)?(?:replied|responded|answered|written back|heard back|gotten back|reply|respond|answer|a reply|no reply|no response)\b(?:\s+(?:yet|by then))?|\bif no (?:reply|response|answer)(?:\s+yet)?\b/;

function atTime(d: Date, h: number, m = 0): Date {
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Explicit time of day in the phrase, if any. */
function timeOfDay(s: string): { h: number; m: number } | undefined {
  let m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].startsWith('p')) h += 12;
    return { h, m: Number(m[2] ?? 0) };
  }
  m = s.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (m && Number(m[1]) < 24) {
    let h = Number(m[1]);
    if (h >= 1 && h <= 6) h += 12; // "at 3" almost always means the afternoon
    return { h, m: Number(m[2] ?? 0) };
  }
  if (/\bnoon\b|\bmidday\b/.test(s)) return { h: 12, m: 0 };
  if (/\btonight\b|\bevening\b/.test(s)) return { h: 19, m: 0 };
  if (/\bafternoon\b/.test(s)) return { h: 14, m: 0 };
  if (/\bmorning\b/.test(s)) return { h: 9, m: 0 };
  if (/\bend of (?:the )?(?:day|week|month)\b|\beod\b|\bclose of business\b|\bcob\b/.test(s)) return { h: 17, m: 0 };
  return undefined;
}

/** The calendar day the phrase names, or undefined. `exact` means a relative time like "in 2 hours". */
function day(s: string, now: Date): { date: Date; exact?: boolean } | undefined {
  let m = s.match(/\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|ten)\s+(minute|min|hour|hr|day|week|month)s?\b/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    const unit = m[2];
    const d = new Date(now);
    if (unit.startsWith('min')) return { date: new Date(now.getTime() + n * 60_000), exact: true };
    if (unit === 'hour' || unit === 'hr') return { date: new Date(now.getTime() + n * 3_600_000), exact: true };
    if (unit === 'day') return { date: addDays(d, n) };
    if (unit === 'week') return { date: addDays(d, 7 * n) };
    d.setMonth(d.getMonth() + n);
    return { date: d };
  }
  if (/\btoday\b|\btonight\b|\bthis (?:morning|afternoon|evening)\b/.test(s)) return { date: new Date(now) };
  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(s)) return { date: addDays(now, 1) };
  if (/\bnext week\b/.test(s)) return { date: addDays(now, ((8 - now.getDay()) % 7) || 7) }; // next Monday
  if (/\b(?:this )?weekend\b/.test(s)) return { date: addDays(now, ((6 - now.getDay() + 7) % 7) || 7) };
  if (/\bend of (?:the )?week\b/.test(s)) return { date: addDays(now, (5 - now.getDay() + 7) % 7) };
  if (/\bend of (?:the )?month\b/.test(s)) return { date: new Date(now.getFullYear(), now.getMonth() + 1, 0) };

  m = s.match(/\b(next|this|on|coming)?\s*(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/);
  if (m) {
    const target = DAYS.findIndex((d) => d.startsWith(m![2].slice(0, 3)));
    let ahead = (target - now.getDay() + 7) % 7;
    if (ahead === 0 && m[1] !== 'this') ahead = 7; // "Friday" said on a Friday means next week's
    // "next Friday" = the Friday of next week (Monday-start), not the coming one.
    if (m[1] === 'next') {
      const daysToNextMonday = ((8 - now.getDay()) % 7) || 7;
      if (ahead < daysToNextMonday) ahead += 7;
    }
    return { date: addDays(now, ahead) };
  }

  const month = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  m = s.match(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  let mo: number | undefined;
  let dd: number | undefined;
  if (m) {
    mo = MONTHS.indexOf(m[1].slice(0, 3));
    dd = Number(m[2]);
  } else {
    m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}`));
    if (m) {
      dd = Number(m[1]);
      mo = MONTHS.indexOf(m[2].slice(0, 3));
    } else {
      m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // US month/day
      if (m) {
        mo = Number(m[1]) - 1;
        dd = Number(m[2]);
        if (m[3]) {
          const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
          return { date: new Date(y, mo, dd) };
        }
      }
    }
  }
  if (mo !== undefined && dd !== undefined && mo >= 0 && mo < 12 && dd >= 1 && dd <= 31) {
    let d = new Date(now.getFullYear(), mo, dd);
    if (atTime(d, 23, 59) < now) d = new Date(now.getFullYear() + 1, mo, dd); // already passed this year
    return { date: d };
  }
  return undefined;
}

/**
 * Parses a reminder or deadline phrase relative to `now`. A date without a time gets `defaultHour`
 * (9am for reminders; deadlines pass 17 for end of day).
 */
export function parseWhen(input: string, now: Date = new Date(), defaultHour = 9): WhenResult {
  let s = ` ${input.toLowerCase().replace(/[’]/g, "'").trim()} `;
  s = s.replace(/^\s*remind me\s*/, ' ');
  const unlessReplied = UNLESS_REPLIED.test(s);
  s = s.replace(UNLESS_REPLIED, ' ');

  const d = day(s, now);
  const t = timeOfDay(s);
  if (!d && !t) return { error: `I couldn't find a time in "${input.trim()}". Try "Friday", "tomorrow at 3pm" or "in 2 days".` };

  let when: Date;
  if (d?.exact) when = d.date;
  else if (d) when = atTime(d.date, t?.h ?? defaultHour, t?.m ?? 0);
  else {
    when = atTime(now, t!.h, t!.m);
    if (when <= now) when = addDays(when, 1); // "at 9am" said at 10am means tomorrow
  }
  if (when.getTime() <= now.getTime()) return { error: 'That time has already passed.' };
  return { at: when.getTime(), unlessReplied };
}

/** "by Friday", "before Nov 3", "end of week" inside a sentence → a deadline at end of day. */
export function deadlineIn(text: string, base: Date): number | undefined {
  const m = text.toLowerCase().match(/\b(?:by|before|no later than|due)\s+([^.,;!?\n]{2,40})/);
  const phrase = m?.[1] ?? (/\bend of (?:the )?(?:day|week|month)\b|\beod\b/.exec(text.toLowerCase())?.[0]);
  if (!phrase) return undefined;
  const r = parseWhen(phrase, base, 17);
  return 'at' in r ? r.at : undefined;
}

export function describeWhen(at: number, now: Date = new Date()): string {
  const d = new Date(at);
  const days = Math.round((atTime(d, 0).getTime() - atTime(now, 0).getTime()) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

export type SnoozeChoice = 'tomorrow' | 'nextweek' | 'reply' | string;

/**
 * When a snooze ends. "tomorrow" = 8:00 tomorrow, "nextweek" = Monday 8:00, "reply" = when they reply
 * (with a 14-day fallback), anything else is parsed as plain English ("Friday 3pm", "in 2 days").
 */
export function snoozeTime(choice: SnoozeChoice, now: Date = new Date()): { at: number; untilReply: boolean; label: string } | { error: string } {
  const morning = (d: Date) => {
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  };
  if (choice === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { at: morning(d), untilReply: false, label: 'until tomorrow morning' };
  }
  if (choice === 'nextweek') {
    const d = new Date(now);
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
    return { at: morning(d), untilReply: false, label: 'until Monday morning' };
  }
  if (choice === 'reply') {
    return { at: now.getTime() + 14 * 86_400_000, untilReply: true, label: 'until they reply (or 2 weeks)' };
  }
  const r = parseWhen(choice, now, 8);
  if ('error' in r) return r;
  if (r.at <= now.getTime()) return { error: 'That time has already passed.' };
  return { at: r.at, untilReply: r.unlessReplied, label: `until ${describeWhen(r.at, now)}${r.unlessReplied ? ', or sooner if they reply' : ''}` };
}
