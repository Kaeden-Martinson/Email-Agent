import type { Store } from './store';
import { DEFAULT_PERMISSIONS, type Update } from '../shared/types';

/** Seeds sample mail so the UI can be tried without connecting an account (npm run demo). */
export function seedDemo(store: Store): void {
  const d = store.data;
  if (d.accounts.length) return;
  d.settings = { ...d.settings, userName: 'Alex', onboarded: true };
  d.accounts.push(
    {
      id: 'demo-gmail',
      kind: 'gmail',
      email: 'alex@gmail.com',
      providerName: 'Gmail',
      addedAt: Date.now(),
      lastSyncAt: Date.now(),
      watching: true,
      permissions: { ...DEFAULT_PERMISSIONS, replies: 'draft' },
    },
    {
      id: 'demo-yahoo',
      kind: 'imap',
      email: 'alex.side@yahoo.com',
      providerName: 'Yahoo Mail',
      addedAt: Date.now(),
      watching: false,
      permissions: { ...DEFAULT_PERMISSIONS, notify: false },
    },
  );
  const now = Date.now();
  const mk = (n: number, from: [string, string], subject: string, mins: number, triage: Update['triage'], body: string): Update => ({
    key: `demo-gmail:${n}`,
    status: 'new',
    triage,
    message: {
      id: String(n),
      accountId: 'demo-gmail',
      threadId: `t${n}`,
      from: { name: from[0], email: from[1] },
      to: ['you@example.com'],
      subject,
      snippet: body.slice(0, 120),
      body,
      receivedAt: now - mins * 60_000,
      webLink: 'https://mail.google.com/',
      isBulk: false,
    },
  });
  const model = 'llama3.1:8b';
  const items = [
    mk(1, ['Priya Shah', 'priya@acme.co'], 'Contract redlines due Friday', 25, {
      category: 'action', priority: 1, model, needsReply: true,
      summary: 'Priya sent the revised contract and needs your sign-off on the indemnity clause by Friday.',
      actionItems: ['Review indemnity clause (section 7)', 'Approve or comment by Friday 5pm'],
      draftReply: 'Hi Priya, thanks for sending these over. I\'ll go through section 7 and get back to you before Friday.',
    }, 'Hi, attached are the redlines. The main open item is the indemnity clause in section 7. We need your sign-off by Friday 5pm.'),
    mk(2, ['Marcus Lee', 'marcus@gmail.com'], 'Dinner Saturday?', 70, {
      category: 'reply', priority: 2, model, needsReply: true,
      summary: 'Marcus is asking whether you are free for dinner on Saturday.',
      actionItems: [],
      draftReply: 'Hey Marcus! Thanks for the invite. Let me check my plans and get back to you shortly.',
    }, 'Hey, are you free for dinner Saturday? Thinking that new ramen place.'),
    mk(3, ['Chase', 'no-reply@alerts.chase.com'], 'Your statement is ready', 180, {
      category: 'notification', priority: 2, model, needsReply: false, draftReply: '',
      summary: 'Your monthly credit card statement is available; payment is due on the 14th.',
      actionItems: ['Pay card balance by the 14th'],
    }, 'Your statement is now available online.'),
    mk(4, ['The Verge', 'newsletter@theverge.com'], 'This week in tech', 300, {
      category: 'newsletter', priority: 3, model, needsReply: false, draftReply: '', actionItems: [],
      summary: 'Weekly tech newsletter covering new phone launches and an AI policy update.',
    }, 'Top stories this week...'),
  ];
  items[1].reply = { state: 'drafted', text: items[1].triage!.draftReply, at: now - 60 * 60_000, auto: true };
  items[3].message.unsubscribe = { url: 'https://example.com/unsub', oneClick: true };

  // A conversation, so the thread view and open questions can be tried.
  items[0].thread = [
    { id: 'p1', from: { name: 'Priya Shah', email: 'priya@acme.co' }, at: now - 3 * 86_400_000, fromMe: false, text: 'Hi Alex, attaching the first draft. Can you review section 7 and confirm the start date?' },
    { id: 'p2', from: { name: 'Alex', email: 'alex@gmail.com' }, at: now - 2 * 86_400_000, fromMe: true, text: 'Start date of Nov 3 works. I will send comments on section 7 by Thursday.' },
    { id: '1', from: { name: 'Priya Shah', email: 'priya@acme.co' }, at: now - 25 * 60_000, fromMe: false, text: 'Hi, attached are the redlines. The main open item is the indemnity clause in section 7. We need your sign-off by Friday 5pm.' },
  ];
  Object.assign(items[0].triage!, {
    openQuestions: ['Sign off on the indemnity clause (section 7) by Friday 5pm'],
    userPromises: ['Send comments on section 7 by Thursday'],
    sources: [2, 3],
    source: 'full',
    reason: 'Read with the 3-message conversation',
    ms: 21_400,
  });

  // A few promotions from one store, so Subscriptions has something to suggest.
  for (let i = 0; i < 4; i++) {
    const u = mk(10 + i, ['ShopMart', 'deals@shopmart.example'], `Flash sale #${i + 1}: up to 60% off`, 600 + i * 1440, {
      category: 'promo', priority: 3, model, needsReply: false, draftReply: '', actionItems: [],
      summary: 'Promotional email advertising a limited-time sale.',
    }, 'Huge savings this weekend only.');
    u.message.unsubscribe = { mailto: 'mailto:unsubscribe@shopmart.example?subject=unsubscribe', oneClick: false };
    u.status = 'done';
    u.auto = { archived: true, labeled: true };
    items.push(u);
  }
  // Not read yet: goes through the real pipeline on startup, so preview-mode proposals show up in Activity.
  const fresh = mk(20, ['ShopMart', 'deals@shopmart.example'], 'Weekend flash sale: 40% off everything', 5, undefined, 'Shop now. 40% off sitewide this weekend only.');
  fresh.message.isBulk = true;
  fresh.message.unsubscribe = { mailto: 'mailto:unsubscribe@shopmart.example?subject=unsubscribe', oneClick: false };
  items.push(fresh);
  for (const u of items) d.updates[u.key] = u;
  d.accounts[0].permissions = { ...d.accounts[0].permissions, labels: true, autoClean: ['promo'] };
  d.briefing = {
    at: now - 20 * 60_000,
    text: 'Priya needs your sign-off on the contract indemnity clause by Friday 5pm. Your credit card payment is due on the 14th. A reply to Marcus about Saturday dinner is drafted and waiting.',
    needYou: 1,
    drafts: 1,
  };
  // Follow-ups: one overdue, one not yet; a commitment; reminders (one due, one pending, one auto-skipped).
  const fu = (id: string, to: string, subject: string, asked: string, sentDaysAgo: number, dueInDays: number, reason: string) => ({
    id, accountId: 'demo-gmail', threadId: `t-${id}`, messageId: id, to: { name: '', email: to }, subject, asked,
    sentAt: now - sentDaysAgo * 86_400_000, dueAt: now + dueInDays * 86_400_000, dueReason: reason,
    webLink: 'https://mail.google.com/', status: 'waiting' as const,
  });
  d.followUps.push(
    fu('f1', 'landlord@rentco.example', 'Lease renewal', 'Could you confirm the new rent amount for 2027?', 5, -1, '3 working days with no reply'),
    fu('f2', 'jsilverman@tntech.edu', 'Campus visit', 'Is there a tour slot on Nov 7?', 1, 2, '3 working days with no reply'),
    { ...fu('f3', 'marcus@gmail.com', 'Dinner Saturday?', 'Does 7pm work?', 2, 1, ''), status: 'replied' as const, repliedAt: now - 3_600_000 },
  );
  d.commitments.push({
    id: 'c1', accountId: 'demo-gmail', text: 'I will send comments on section 7 by Thursday.', dueAt: now + 86_400_000,
    source: 'sent', subject: 'Re: Contract redlines', withWhom: 'priya@acme.co', at: now - 2 * 86_400_000, status: 'open',
  });
  d.reminders.push(
    { id: 'r1', target: { kind: 'followup', id: 'f1' }, title: 'Follow up with landlord@rentco.example: Lease renewal', phrase: "this morning if they haven't replied", at: now - 60_000, unlessReplied: true, createdAt: now - 86_400_000, status: 'pending' },
    { id: 'r2', target: { kind: 'followup', id: 'f2' }, title: 'Follow up with jsilverman@tntech.edu: Campus visit', phrase: 'Monday if no reply', at: now + 3 * 86_400_000, unlessReplied: true, createdAt: now, status: 'pending' },
    { id: 'r3', target: { kind: 'followup', id: 'f3' }, title: 'Follow up with marcus@gmail.com: Dinner Saturday?', phrase: "this morning if they haven't replied", at: now - 120_000, unlessReplied: true, createdAt: now - 86_400_000, status: 'pending' },
  );
  // Bills, deadlines and events, as verified extraction would file them.
  const day = (n: number, h?: number) => {
    const x = new Date(now + n * 86_400_000);
    x.setHours(h ?? 0, 0, 0, 0);
    return x.getTime();
  };
  const item = (id: string, key: string, sender: string, subject: string, kind: 'bill' | 'deadline' | 'event', title: string, at: number, allDay: boolean, confidence: 'high' | 'medium' | 'low', evidence: string, notes: string[], amount?: number) => ({
    id, accountId: 'demo-gmail', key, sender, subject, kind, title, at, allDay, amount, currency: amount ? 'USD' : undefined,
    evidence, explicit: confidence === 'high', confidence, notes, sourceKeys: [key], createdAt: now, status: 'open' as const,
  });
  d.items.push(
    item('i1', 'demo-gmail:3', 'no-reply@alerts.chase.com', 'Your statement is ready', 'bill', 'Chase card payment', day(2), true, 'high',
      'A minimum payment of $35.00 is due Oct 26.', [], 35),
    item('i2', 'demo-gmail:1', 'priya@acme.co', 'Contract redlines due Friday', 'deadline', 'Sign off on contract redlines', day(1, 17), false, 'high',
      'We need your sign-off by Friday 5pm.', []),
    item('i3', 'demo-gmail:3', 'billing@verizon.example', 'Your Verizon bill is ready', 'bill', 'Verizon payment', day(-1), true, 'medium',
      'Please pay $84.50 by 10/22 to avoid a late fee.', ['"10/22" read as October 22 (US month/day order)', 'The email mentions several amounts ($142.18, $84.50). Check which one you owe.'], 84.5),
    item('i4', 'demo-gmail:2', 'jsilverman@tntech.edu', 'Tennessee Tech is in Mt. Juliet Thursday', 'event', 'Tech to You info session', day(5, 17) + 30 * 60_000, false, 'high',
      'Thursday, Oct. 29 | 5:30--7 p.m. CT', []),
  );
  const t = new Date(now);
  d.lastBriefingDay = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  store.save();
}
