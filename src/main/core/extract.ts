// Facts in email text: money amounts and calendar dates, and verification of what the model extracted
// against the actual email. Anything the email doesn't state word for word is marked as inferred.
import type { KeyItemDraft, KeyItemKind } from '../../shared/types';

export interface Money {
  amount: number;
  currency: string;
  text: string;
}

const SYMBOL: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/** "$1,234.56", "USD 90.00", "90.00 USD", "€45". */
export function findAmounts(text: string): Money[] {
  const out: Money[] = [];
  const re =
    /(?:\b(USD|EUR|GBP|CAD|AUD)\s?)?([$€£])\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})\s?(USD|EUR|GBP|CAD|AUD)\b/gi;
  for (const m of text.matchAll(re)) {
    const num = Number((m[3] ?? m[4]).replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    const currency = (m[1] ?? m[5] ?? SYMBOL[m[2]] ?? 'USD').toUpperCase();
    out.push({ amount: num, currency, text: m[0].trim() });
  }
  return out;
}

export interface FoundDate {
  /** Local timestamp: midnight for all-day dates. */
  at: number;
  allDay: boolean;
  text: string;
  /** e.g. "03/11 read as March 11 (US month/day order)". */
  ambiguous?: string;
  /** Time zone the email stated, e.g. "ET". */
  tz?: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

/** UTC offsets (hours) for zones emails commonly state. */
const TZ: Record<string, number> = {
  utc: 0, gmt: 0, z: 0,
  et: -5, est: -5, edt: -4, ct: -6, cst: -6, cdt: -5, mt: -7, mst: -7, mdt: -6, pt: -8, pst: -8, pdt: -7,
  bst: 1, cet: 1, cest: 2,
};

/** A year for a month/day with no year: the one closest to the email's date (dates up to ~2 months back count). */
function inferYear(month: number, day: number, base: Date): number {
  const candidates = [base.getFullYear() - 1, base.getFullYear(), base.getFullYear() + 1];
  const score = (y: number) => {
    const diff = (new Date(y, month, day).getTime() - base.getTime()) / 86_400_000;
    return diff < -60 ? Infinity : Math.abs(diff);
  };
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

function timeAfter(text: string, from: number): { h: number; m: number; tz?: string } | undefined {
  const tail = text.slice(from, from + 40);
  const t = tail.match(/^[,\s]*(?:at|@|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(utc|gmt|et|est|edt|ct|cst|cdt|mt|mst|mdt|pt|pst|pdt|bst|cet|cest)?\b/i);
  if (!t || (!t[3] && !t[2])) return undefined; // "Nov 3 2026" isn't a time
  let h = Number(t[1]);
  if (t[3]) h = (h % 12) + (t[3].toLowerCase().startsWith('p') ? 12 : 0);
  if (h > 23) return undefined;
  return { h, m: Number(t[2] ?? 0), tz: t[4]?.toLowerCase() };
}

function build(y: number, mo: number, d: number, text: string, base: string, after: number): FoundDate | undefined {
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return undefined;
  const date = new Date(y, mo, d);
  if (date.getMonth() !== mo) return undefined; // e.g. Feb 31
  const t = timeAfter(base, after);
  if (!t) return { at: date.getTime(), allDay: true, text };
  if (t.tz && TZ[t.tz] !== undefined) {
    // Convert the stated zone to local time.
    const utc = Date.UTC(y, mo, d, t.h - TZ[t.tz], t.m);
    return { at: utc, allDay: false, text, tz: t.tz.toUpperCase() };
  }
  return { at: new Date(y, mo, d, t.h, t.m).getTime(), allDay: false, text };
}

/** Explicit calendar dates in text ("Nov 14", "November 14, 2026 at 3pm ET", "11/14/2026", "2026-11-14"). */
export function findDates(text: string, base: Date): FoundDate[] {
  const out: FoundDate[] = [];
  const lower = text.toLowerCase();
  const push = (f: FoundDate | undefined) => f && !out.some((o) => o.at === f.at) && out.push(f);

  for (const m of lower.matchAll(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3));
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, base);
    push(build(y, mo, d, text.substr(m.index!, m[0].length), lower, m.index! + m[0].length));
  }
  for (const m of lower.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?`, 'g'))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3));
    const d = Number(m[1]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, base);
    push(build(y, mo, d, text.substr(m.index!, m[0].length), lower, m.index! + m[0].length));
  }
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[0], lower, m.index! + m[0].length));
  }
  for (const m of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b > 12) continue;
    // US order unless the first number can't be a month.
    const [mo, d] = a > 12 ? [b - 1, a] : [a - 1, b];
    const y = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear(mo, d, base);
    const f = build(y, mo, d, m[0], lower, m.index! + m[0].length);
    if (f && a <= 12 && b <= 12 && a !== b) {
      f.ambiguous = `"${m[0]}" read as ${new Date(f.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} (US month/day order)`;
    }
    push(f);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Cheap check before asking the model for key items: does the email mention a date, money or a deadline at all? */
export function mentionsDatesOrMoney(text: string, base: Date): boolean {
  return (
    findAmounts(text).length > 0 ||
    findDates(text, base).length > 0 ||
    /\b(?:due|deadline|appointment|reservation|rsvp|tomorrow|tonight|today at|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|next (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(text)
  );
}

/** Items worth tracking: anything with a date, or a bill with an amount. A receipt for a finished payment is neither. */
export function worthTracking(v: { kind: string; at?: number; amount?: number }): boolean {
  return v.at !== undefined || (v.kind === 'bill' && v.amount !== undefined);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”"’']/g, '').trim();

export type Confidence = 'high' | 'medium' | 'low';

export interface VerifiedItem {
  kind: KeyItemKind;
  title: string;
  at?: number;
  allDay: boolean;
  amount?: number;
  currency?: string;
  evidence: string;
  /** Every fact shown was found word for word in the email. */
  explicit: boolean;
  confidence: Confidence;
  notes: string[];
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const money = (m: { amount: number; currency?: string }) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency || 'USD' }).format(m.amount);

/**
 * Checks a model-extracted item against the email. The email text wins over the model: a date or amount
 * that isn't in the quoted evidence is either replaced by what the text says or marked as inferred.
 */
export function verifyItem(raw: KeyItemDraft, emailText: string, base: Date): VerifiedItem | undefined {
  const title = String(raw.title ?? '').trim().slice(0, 120);
  if (!title) return undefined;
  const notes: string[] = [];
  const evidence = String(raw.evidence ?? '').trim().slice(0, 300);
  const evidenceFound = evidence.length >= 6 && norm(emailText).includes(norm(evidence));
  if (!evidenceFound) notes.push('Inferred by the AI: not stated word for word in the email.');

  // Dates: prefer what the quoted text says.
  const textDates = findDates(evidenceFound ? evidence : '', base);
  const modelDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.date ?? '') ? findDates(raw.date!, base)[0] : undefined;
  let date: FoundDate | undefined;
  let dateExplicit = true;
  if (textDates.length) {
    date = (modelDate && textDates.find((d) => sameDay(d.at, modelDate.at))) ?? textDates[0];
    if (modelDate && !textDates.some((d) => sameDay(d.at, modelDate.at))) {
      notes.push(`The AI read the date as ${new Date(modelDate.at).toDateString()}, but the email says "${textDates[0].text}". Using the email's date.`);
    }
    if (textDates.length > 1 && !textDates.every((d) => sameDay(d.at, textDates[0].at))) {
      notes.push(`The email mentions more than one date (${textDates.map((d) => `"${d.text}"`).join(', ')}). Check which one applies.`);
    }
  } else if (modelDate) {
    date = modelDate;
    dateExplicit = false;
    notes.push('Date inferred by the AI; the email does not state it explicitly.');
  }
  // A time the model gave for an all-day date it read correctly.
  if (date?.allDay && /^\d{2}:\d{2}$/.test(raw.time ?? '') && dateExplicit && /\d\s*(am|pm)|\d:\d\d/i.test(evidence)) {
    const [h, m] = raw.time!.split(':').map(Number);
    const d = new Date(date.at);
    d.setHours(h, m, 0, 0);
    date = { ...date, at: d.getTime(), allDay: false };
  }
  if (date?.ambiguous) notes.push(date.ambiguous);
  if (date?.tz) notes.push(`The email gives the time in ${date.tz}; shown in your local time.`);

  // Amounts: never invented. Only amounts present in the text are kept.
  const textAmounts = findAmounts(evidenceFound ? evidence : '');
  const modelAmount = typeof raw.amount === 'number' && raw.amount > 0 ? raw.amount : undefined;
  let amount: Money | undefined;
  let amountExplicit = true;
  if (textAmounts.length) {
    amount = (modelAmount !== undefined && textAmounts.find((a) => Math.abs(a.amount - modelAmount) < 0.005)) || textAmounts[0];
    if (modelAmount !== undefined && !textAmounts.some((a) => Math.abs(a.amount - modelAmount) < 0.005)) {
      notes.push(`The AI read the amount as ${money({ amount: modelAmount, currency: raw.currency })}, but the email says ${textAmounts[0].text}. Using the email's amount.`);
    }
    const distinct = [...new Set(textAmounts.map((a) => a.amount))];
    if (distinct.length > 1) notes.push(`The email mentions several amounts (${textAmounts.map((a) => a.text).join(', ')}). Check which one you owe.`);
  } else if (modelAmount !== undefined) {
    amountExplicit = false;
    const anywhere = findAmounts(emailText).find((a) => Math.abs(a.amount - modelAmount) < 0.005);
    if (anywhere) {
      amount = anywhere;
      notes.push('Amount found elsewhere in the email, not in the quoted sentence.');
    } else {
      notes.push('The AI suggested an amount the email does not contain, so it was left out.');
    }
  }

  const conflicts = notes.some((n) => /but the email says|more than one date|several amounts/.test(n));
  const explicit = evidenceFound && dateExplicit && amountExplicit;
  const confidence: Confidence = !evidenceFound ? 'low' : explicit && !conflicts && !date?.ambiguous ? 'high' : 'medium';
  return {
    kind: raw.kind,
    title,
    at: date?.at,
    allDay: date?.allDay ?? true,
    amount: amount?.amount,
    currency: amount?.currency,
    evidence,
    explicit,
    confidence,
    notes,
  };
}
