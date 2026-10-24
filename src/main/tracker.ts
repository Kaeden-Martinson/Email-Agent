import * as crypto from 'node:crypto';
import type {
  Account,
  Commitment,
  EmailMessage,
  FollowUp,
  KeyItem,
  OwedReply,
  Reminder,
  ReminderTarget,
  Settings,
  Update,
} from '../shared/types';
import { messageText, verifyItem, worthTracking } from './core/extract';
import { expectsReply, extractCommitments, followUpDue, isPersonalRecipient, replyArrived } from './core/followups';
import { domainOf } from './core/rules';
import { deadlineIn, describeWhen, parseWhen } from './core/when';
import { createProvider } from './providers';
import type { Store } from './store';

const DAY = 86_400_000;
/** Re-check a conversation for replies at most this often. */
const RECHECK_MS = 20 * 60_000;
/** Conversations checked per sync, to stay gentle on provider rate limits. */
const CHECKS_PER_SYNC = 15;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface TrackerDeps {
  store: Store;
  settings: () => Settings;
  changed: () => void;
  /** Called when a reminder comes due. */
  onReminder: (r: Reminder) => void;
  /** Called when someone replies to an email you were waiting on. */
  onReply: (f: FollowUp) => void;
}

/**
 * Follow-ups and commitments: what you're waiting on, what you owe, what you promised, and reminders.
 * Replies are always checked against the real conversation before anything is shown as overdue or a
 * reminder fires, so a resolved thread never nags.
 */
export class Tracker {
  constructor(private readonly deps: TrackerDeps) {}

  private get d() {
    return this.deps.store.data;
  }

  private get s() {
    return this.deps.settings();
  }

  // ---- scanning ----

  /** Finds new questions and promises in your sent mail. Read-only. */
  async scanSent(account: Account): Promise<void> {
    const started = Date.now();
    const since = account.lastSentScanAt ? account.lastSentScanAt - 10 * 60_000 : started - 14 * DAY;
    const sent = await createProvider(account, this.s).fetchSent(since, 30);
    const known = new Set(this.d.followUps.map((f) => f.messageId));
    const me = account.email.toLowerCase();
    for (const m of sent) {
      const to = m.to.find((e) => e.toLowerCase() !== me);
      if (!to || !isPersonalRecipient(to)) continue;
      const asked = expectsReply(m.body);
      if (asked && !known.has(m.id)) {
        const due = followUpDue(m.body, m.receivedAt, this.s.followUpDays);
        this.d.followUps.push({
          id: crypto.randomUUID(),
          accountId: account.id,
          threadId: m.threadId,
          messageId: m.id,
          messageIdHeader: m.messageIdHeader,
          references: m.references,
          to: { name: '', email: to },
          subject: m.subject,
          sentAt: m.receivedAt,
          asked,
          dueAt: due.at,
          dueReason: due.reason,
          webLink: m.webLink,
          status: 'waiting',
        });
      }
      extractCommitments(m.body, m.receivedAt).forEach((c, i) =>
        this.addCommitment({
          id: `sent:${m.id}:${i}`,
          accountId: account.id,
          text: c.text,
          dueAt: c.dueAt,
          source: 'sent',
          subject: m.subject,
          withWhom: to,
          at: m.receivedAt,
        }),
      );
    }
    account.lastSentScanAt = started;
  }

  /** Promises the model found in a conversation (stage 4) become commitments too. */
  noteConversationPromises(u: Update): void {
    for (const text of u.triage?.userPromises ?? []) {
      this.addCommitment({
        id: `conv:${u.message.threadId}:${text.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80)}`,
        accountId: u.message.accountId,
        text,
        dueAt: deadlineIn(text, new Date(u.message.receivedAt)),
        source: 'conversation',
        subject: u.message.subject,
        withWhom: u.message.from.email,
        at: u.message.receivedAt,
        updateKey: u.key,
      });
    }
  }

  /**
   * Verifies the model's extracted dates and amounts against the email and files them. Several emails
   * about the same bill or event (same kind, day, amount and sender domain) become one item.
   */
  ingestItems(u: Update): void {
    const text = messageText(u.message);
    const base = new Date(u.message.receivedAt);
    const sender = u.message.from.email.toLowerCase();
    const day = (at?: number) => (at === undefined ? '' : new Date(at).toDateString());
    const rank = { high: 2, medium: 1, low: 0 };
    for (const draft of u.triage?.keyItems ?? []) {
      const v = verifyItem(draft, text, base);
      if (!v || !worthTracking(v)) continue;
      const same = this.d.items.find(
        (i) =>
          i.status !== 'dismissed' &&
          i.kind === v.kind &&
          day(i.at) === day(v.at) &&
          i.amount === v.amount &&
          domainOf(i.sender) === domainOf(sender),
      );
      if (same) {
        if (!same.sourceKeys.includes(u.key)) same.sourceKeys.push(u.key);
        // Point at the newest email that mentions it (dates kept on the item, not looked up).
        if (u.message.receivedAt >= (same.lastAt ?? 0)) Object.assign(same, { key: u.key, lastAt: u.message.receivedAt });
        // Keep the more certain reading.
        if (rank[v.confidence] > rank[same.confidence]) {
          Object.assign(same, { confidence: v.confidence, explicit: v.explicit, evidence: v.evidence, notes: v.notes });
        }
        continue;
      }
      this.d.items.push({
        id: crypto.randomUUID(),
        accountId: u.message.accountId,
        key: u.key,
        sender,
        subject: u.message.subject,
        ...v,
        sourceKeys: [u.key],
        lastAt: u.message.receivedAt,
        createdAt: Date.now(),
        status: 'open',
      });
    }
  }

  setItem(id: string, status: KeyItem['status']): void {
    const i = this.d.items.find((x) => x.id === id);
    if (!i) throw new Error('That item no longer exists.');
    i.status = status;
    this.deps.changed();
  }

  private addCommitment(c: Omit<Commitment, 'status'>): void {
    if (this.d.commitments.some((x) => x.id === c.id)) return;
    this.d.commitments.push({ ...c, status: 'open' });
  }

  /** Marks follow-ups replied and owed replies answered by looking at the real conversations. */
  async checkReplies(account: Account): Promise<void> {
    const provider = createProvider(account, this.s);
    const now = Date.now();
    let budget = CHECKS_PER_SYNC;

    const waiting = this.d.followUps
      .filter((f) => f.accountId === account.id && f.status === 'waiting' && (f.checkedAt ?? 0) < now - RECHECK_MS)
      .sort((a, b) => a.dueAt - b.dueAt);
    for (const f of waiting) {
      if (budget-- <= 0) return;
      try {
        const reply = replyArrived(await provider.fetchThread(this.asMessage(f)), f.sentAt, false, account.email);
        f.checkedAt = now;
        if (reply) {
          Object.assign(f, { status: 'replied', repliedAt: reply.receivedAt });
          this.deps.onReply(f);
        }
      } catch {
        // Try again next sync.
      }
    }

    for (const o of this.owed().filter((x) => x.accountId === account.id)) {
      if ((this.d.owedCheckedAt[o.key] ?? 0) > now - RECHECK_MS) continue;
      if (budget-- <= 0) return;
      const u = this.d.updates[o.key];
      try {
        const mine = replyArrived(await provider.fetchThread(u.message), u.message.receivedAt, true, account.email);
        this.d.owedCheckedAt[o.key] = now;
        if (mine && u.triage) {
          // You answered from your mail app; nothing is waiting on you any more.
          Object.assign(u.triage, { needsReply: false, repliedAlready: true, openQuestions: [], reason: 'You already replied in this conversation' });
        }
      } catch {
        // Try again next sync.
      }
    }
  }

  /** A minimal message for provider calls about one of your sent emails. */
  private asMessage(f: FollowUp): EmailMessage {
    return {
      id: f.messageId,
      accountId: f.accountId,
      threadId: f.threadId,
      from: f.to,
      to: [],
      subject: f.subject,
      snippet: '',
      body: '',
      receivedAt: f.sentAt,
      webLink: f.webLink,
      messageIdHeader: f.messageIdHeader,
      references: f.references,
      isBulk: false,
    };
  }

  // ---- views ----

  owed(): OwedReply[] {
    const cutoff = Date.now() - this.s.followUpDays * DAY;
    return Object.values(this.d.updates)
      .filter((u) => u.status !== 'done' && u.triage?.needsReply && !u.triage.repliedAlready && u.reply?.state !== 'sent')
      .map((u) => ({
        key: u.key,
        accountId: u.message.accountId,
        from: u.message.from,
        subject: u.message.subject,
        receivedAt: u.message.receivedAt,
        openQuestions: u.triage!.openQuestions ?? [],
        overdue: u.message.receivedAt < cutoff,
      }))
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  prune(): void {
    const old = Date.now() - 45 * DAY;
    this.d.followUps = this.d.followUps.filter((f) => f.sentAt > old || f.status === 'waiting');
    this.d.commitments = this.d.commitments.filter((c) => c.at > old || c.status === 'open');
    this.d.items = this.d.items.filter((i) => i.status === 'open' || (i.at ?? i.createdAt) > old);
    this.d.reminders = this.d.reminders.filter((r) => r.status === 'pending' || r.status === 'due' || r.at > Date.now() - 14 * DAY);
    for (const key of Object.keys(this.d.owedCheckedAt)) if (!this.d.updates[key]) delete this.d.owedCheckedAt[key];
  }

  // ---- reminders ----

  preview(phrase: string): { at: number; unlessReplied: boolean; label: string } | { error: string } {
    const r = parseWhen(phrase);
    if ('error' in r) return r;
    return { ...r, label: `${describeWhen(r.at)}${r.unlessReplied ? ', only if there is still no reply' : ''}` };
  }

  remind(target: ReminderTarget, phrase: string): void {
    const r = parseWhen(phrase);
    if ('error' in r) throw new Error(r.error);
    this.d.reminders.push({
      id: crypto.randomUUID(),
      target,
      title: this.titleOf(target),
      phrase: phrase.trim(),
      at: r.at,
      unlessReplied: r.unlessReplied,
      createdAt: Date.now(),
      status: 'pending',
    });
    this.deps.changed();
  }

  private titleOf(t: ReminderTarget): string {
    if (t.kind === 'update') {
      const u = this.d.updates[t.key];
      if (!u) throw new Error('That email is no longer on the list.');
      return `Reply to ${u.message.from.name || u.message.from.email}: ${u.message.subject}`;
    }
    if (t.kind === 'followup') {
      const f = this.d.followUps.find((x) => x.id === t.id);
      if (!f) throw new Error('That follow-up no longer exists.');
      return `Follow up with ${f.to.email}: ${f.subject}`;
    }
    if (t.kind === 'item') {
      const i = this.d.items.find((x) => x.id === t.id);
      if (!i) throw new Error('That item no longer exists.');
      return i.title;
    }
    const c = this.d.commitments.find((x) => x.id === t.id);
    if (!c) throw new Error('That commitment no longer exists.');
    return c.text;
  }

  cancelReminder(id: string): void {
    const r = this.d.reminders.find((x) => x.id === id);
    if (!r) throw new Error('That reminder no longer exists.');
    r.status = 'cancelled';
    this.deps.changed();
  }

  /** Runs every minute. "Unless replied" reminders check the live conversation before firing. */
  async tick(): Promise<void> {
    const now = Date.now();
    for (const r of this.d.reminders.filter((x) => x.status === 'pending' && x.at <= now)) {
      const resolved = r.unlessReplied ? await this.resolvedBy(r.target) : undefined;
      if (resolved) {
        Object.assign(r, { status: 'resolved', note: resolved });
      } else {
        r.status = 'due';
        this.deps.onReminder(r);
      }
      this.deps.changed();
    }
  }

  /** Why an "unless replied" reminder is no longer needed, or undefined if it still is. */
  private async resolvedBy(t: ReminderTarget): Promise<string | undefined> {
    try {
      if (t.kind === 'followup') {
        const f = this.d.followUps.find((x) => x.id === t.id);
        if (!f) return 'The follow-up was removed';
        if (f.status !== 'waiting') return f.status === 'replied' ? 'They replied, so no reminder was needed' : 'You marked it done';
        const account = this.d.accounts.find((a) => a.id === f.accountId);
        if (!account) return 'The mailbox was removed';
        const reply = replyArrived(await createProvider(account, this.s).fetchThread(this.asMessage(f)), f.sentAt, false, account.email);
        if (reply) {
          Object.assign(f, { status: 'replied', repliedAt: reply.receivedAt });
          return 'They replied, so no reminder was needed';
        }
        return undefined;
      }
      if (t.kind === 'update') {
        const u = this.d.updates[t.key];
        if (!u) return 'The email was removed';
        if (u.triage?.repliedAlready || u.reply?.state === 'sent') return 'You already replied';
        const account = this.d.accounts.find((a) => a.id === u.message.accountId);
        if (!account) return 'The mailbox was removed';
        const mine = replyArrived(await createProvider(account, this.s).fetchThread(u.message), u.message.receivedAt, true, account.email);
        return mine ? 'You already replied' : undefined;
      }
      if (t.kind === 'item') {
        const i = this.d.items.find((x) => x.id === t.id);
        return !i || i.status !== 'open' ? 'You marked it done' : undefined;
      }
      const c = this.d.commitments.find((x) => x.id === t.id);
      return !c || c.status !== 'open' ? 'You marked it done' : undefined;
    } catch (e) {
      // If we can't check, remind anyway: a missed reminder is worse than an extra one.
      void errorText(e);
      return undefined;
    }
  }

  setFollowUp(id: string, status: FollowUp['status']): void {
    const f = this.d.followUps.find((x) => x.id === id);
    if (!f) throw new Error('That follow-up no longer exists.');
    f.status = status;
    this.deps.changed();
  }

  setCommitment(id: string, status: Commitment['status']): void {
    const c = this.d.commitments.find((x) => x.id === id);
    if (!c) throw new Error('That commitment no longer exists.');
    c.status = status;
    this.deps.changed();
  }

  /** The polite nudge text; the engine saves it as a draft (never sends). */
  nudgeText(f: FollowUp, signature: string): string {
    const first = f.to.name.split(' ')[0] || '';
    const lines = [`Hi${first ? ` ${first}` : ''},`, '', `Just following up on my email below about "${f.subject}". Any update when you get a chance?`, '', 'Thanks!'];
    if (signature.trim()) lines.push('', signature.trim());
    return lines.join('\n');
  }

  nudgeTarget(f: FollowUp): EmailMessage {
    return this.asMessage(f);
  }

  /** Counts for the morning briefing and the nav badge. */
  overdueCount(): number {
    const now = Date.now();
    return (
      this.owed().filter((o) => o.overdue).length +
      this.d.followUps.filter((f) => f.status === 'waiting' && f.dueAt <= now).length +
      this.d.commitments.filter((c) => c.status === 'open' && c.dueAt && c.dueAt <= now).length +
      this.d.reminders.filter((r) => r.status === 'due').length +
      this.d.items.filter((i) => i.status === 'open' && i.at !== undefined && itemDeadline(i) <= now).length
    );
  }

  /** Bills, deadlines and events in the next `days` days (and anything overdue). */
  upcomingItems(days: number): KeyItem[] {
    const until = Date.now() + days * DAY;
    return this.d.items.filter((i) => i.status === 'open' && i.at !== undefined && i.at <= until).sort((a, b) => a.at! - b.at!);
  }
}

/** An all-day item is due at the end of its day. */
export function itemDeadline(i: Pick<KeyItem, 'at' | 'allDay'>): number {
  if (i.at === undefined) return Infinity;
  if (!i.allDay) return i.at;
  const d = new Date(i.at);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
