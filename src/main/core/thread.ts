// Conversation handling: separating new text from quoted history, and turning a provider's thread into
// the compact, numbered form the model and the UI use. Pure, so it is unit-tested.
import type { EmailMessage, ThreadMessage } from '../../shared/types';

/** Lines that start the quoted history in replies from common mail clients. */
function startsQuote(lines: string[], i: number): boolean {
  const line = lines[i];
  const next = lines[i + 1] ?? '';
  if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) return true;
  if (/^\s*_{10,}\s*$/.test(line)) return true; // Outlook's separator line
  // Outlook / Apple header block: "From: …" followed within a few lines by "Sent:" or "Date:".
  if (/^\s*\*?From:\*?\s.+/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^\s*\*?(Sent|Date):\*?\s/i.test(l))) return true;
  // Gmail / Apple: "On <date>, <name> wrote:", sometimes wrapped onto two lines.
  if (/^\s*On\b.{0,250}\bwrote:\s*$/i.test(line)) return true;
  if (/^\s*On\b.{0,250}$/i.test(line) && !/wrote:/i.test(line) && /^\s*.{0,120}\bwrote:\s*$/i.test(next)) return true;
  return false;
}

/**
 * The new part of a message: drops "> " quoted lines and everything from a reply header onward.
 * Forwarded content is kept, since there the "quote" is the point. Falls back to the original when
 * stripping would leave nothing.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-{5,}\s*Forwarded message/i.test(lines[i])) {
      out.push(...lines.slice(i));
      break;
    }
    if (startsQuote(lines, i)) break;
    if (/^\s*>/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  const stripped = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return stripped || text.trim();
}

/** Keep the model's context small: the newest messages matter most. */
export const MAX_THREAD_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 1500;

export interface ThreadView {
  /** Oldest first; ends with the current message. */
  thread: ThreadMessage[];
  /** You replied after the current message, so nothing is waiting on you. */
  repliedAfter: boolean;
}

/** Builds the conversation up to and including `current`, and notes whether you replied after it. */
export function buildThread(messages: readonly EmailMessage[], current: EmailMessage, myEmail: string): ThreadView {
  const me = myEmail.toLowerCase();
  const byTime = [...messages].sort((a, b) => a.receivedAt - b.receivedAt);
  if (!byTime.some((m) => m.id === current.id || (!!m.messageIdHeader && m.messageIdHeader === current.messageIdHeader))) {
    byTime.push(current);
    byTime.sort((a, b) => a.receivedAt - b.receivedAt);
  }
  const isCurrent = (m: EmailMessage) => m.id === current.id || (!!m.messageIdHeader && m.messageIdHeader === current.messageIdHeader);
  const idx = byTime.findIndex(isCurrent);
  const repliedAfter = byTime.slice(idx + 1).some((m) => m.from.email.toLowerCase() === me);
  const upTo = byTime.slice(0, idx + 1).slice(-MAX_THREAD_MESSAGES);
  return {
    repliedAfter,
    thread: upTo.map((m) => ({
      id: m.id,
      from: m.from,
      at: m.receivedAt,
      fromMe: m.from.email.toLowerCase() === me,
      text: stripQuoted(m.body || m.snippet).slice(0, MAX_MESSAGE_CHARS),
    })),
  };
}

/** The numbered conversation given to the model. The newest message is last. */
export function formatThread(thread: readonly ThreadMessage[]): string {
  return thread
    .map((m, i) => {
      const who = m.fromMe ? 'The user (you are writing for them)' : m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
      return `[${i + 1}] ${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')} · ${who}:\n${m.text}`;
    })
    .join('\n\n');
}
