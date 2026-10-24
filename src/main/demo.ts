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
  for (const u of items) d.updates[u.key] = u;
  d.accounts[0].permissions = { ...d.accounts[0].permissions, labels: true, autoClean: ['promo'] };
  d.briefing = {
    at: now - 20 * 60_000,
    text: 'Priya needs your sign-off on the contract indemnity clause by Friday 5pm. Your credit card payment is due on the 14th. A reply to Marcus about Saturday dinner is drafted and waiting.',
    needYou: 1,
    drafts: 1,
  };
  const t = new Date(now);
  d.lastBriefingDay = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  store.save();
}
