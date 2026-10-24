// Deterministic follow-up logic: does a message you sent expect an answer, what did you promise,
// and has the other side (or you) replied since. No AI, so it is predictable and testable.
import type { EmailMessage } from '../../shared/types';
import { stripQuoted } from './thread';
import { deadlineIn } from './when';

const ACKNOWLEDGEMENT = /^(?:hi[^\n]*\n+)?\s*(?:thanks|thank you|thx|ty|great|perfect|ok|okay|sounds good|got it|will do|cheers|awesome|noted)[!. ]*(?:\n[\s\S]{0,60})?$/i;

const REQUEST =
  /\b(?:let me know|please (?:send|confirm|reply|respond|advise|review|share|let)|could you|can you|would you|will you|are you able|when can|when will|what do you think|thoughts\?|any update|waiting (?:for|on) (?:your|you)|looking forward to (?:hearing|your)|get back to me|confirm (?:by|that|if|whether))\b/i;

/** The first sentence that asks something, or undefined when the message expects no answer. */
export function expectsReply(text: string): string | undefined {
  const own = stripQuoted(text).trim();
  if (!own || own.length < 8 || ACKNOWLEDGEMENT.test(own)) return undefined;
  const sentences = own.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  return sentences.find((s) => s.endsWith('?') || REQUEST.test(s))?.slice(0, 200);
}

const PROMISE = /\b(?:i'll|i will|i'm going to|i am going to|i shall|let me (?:send|check|get back|look into|find out|follow up)|i can (?:send|get)|i'll get back|will send|will get back to you)\b/i;
/** "I'll be in the office" isn't a commitment to anyone. */
const NOT_A_PROMISE = /\b(?:i'll be (?:out|away|in|on|at|travel)|i will be (?:out|away|in|on|at|travel)|if i'll|i'll see you)\b/i;

export interface FoundCommitment {
  text: string;
  dueAt?: number;
}

/** Promises you made in a message you sent, with a deadline when one is stated ("by Friday"). */
export function extractCommitments(text: string, sentAt: number): FoundCommitment[] {
  const own = stripQuoted(text);
  return own
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6 && !s.endsWith('?') && PROMISE.test(s) && !NOT_A_PROMISE.test(s))
    .slice(0, 5)
    .map((s) => ({ text: s.slice(0, 200), dueAt: deadlineIn(s, new Date(sentAt)) }));
}

/** Has someone on the given side written in the conversation after `afterAt`? */
export function replyArrived(messages: readonly EmailMessage[], afterAt: number, fromMe: boolean, myEmail: string): EmailMessage | undefined {
  const me = myEmail.toLowerCase();
  return messages
    .filter((m) => m.receivedAt > afterAt && (m.from.email.toLowerCase() === me) === fromMe)
    .sort((a, b) => a.receivedAt - b.receivedAt)[0];
}

/** When to nudge if nobody replies: a stated deadline if there is one, otherwise N working days later. */
export function followUpDue(text: string, sentAt: number, workingDays: number): { at: number; reason: string } {
  const deadline = deadlineIn(stripQuoted(text), new Date(sentAt));
  if (deadline && deadline > sentAt) return { at: deadline, reason: 'the deadline in your email' };
  const d = new Date(sentAt);
  let added = 0;
  while (added < workingDays) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  d.setHours(9, 0, 0, 0);
  return { at: d.getTime(), reason: `${workingDays} working day${workingDays === 1 ? '' : 's'} with no reply` };
}

/** Automated or list addresses never owe you a reply. */
export function isPersonalRecipient(email: string): boolean {
  return !!email && !/(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|support@|help@|info@|newsletter|bounce)/i.test(email);
}
