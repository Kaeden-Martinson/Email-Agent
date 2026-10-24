import { DEFAULT_PERMISSIONS, type Account, type AccountPermissions, type EmailMessage, type Triage, type Update } from '../src/shared/types';

export function account(perms: Partial<AccountPermissions> = {}): Account {
  return {
    id: 'acc1',
    kind: 'gmail',
    email: 'me@example.com',
    providerName: 'Gmail',
    addedAt: 0,
    watching: true,
    permissions: { ...DEFAULT_PERMISSIONS, ...perms },
  };
}

export function message(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'm1',
    accountId: 'acc1',
    threadId: 't1',
    from: { name: 'Dana Kim', email: 'dana@studio.io' },
    to: ['me@example.com'],
    subject: 'Quick question',
    snippet: 'Can you send the deck?',
    body: 'Hi, can you send the deck by Wednesday?',
    receivedAt: 0,
    webLink: '',
    isBulk: false,
    ...over,
  };
}

export function triage(over: Partial<Triage> = {}): Triage {
  return {
    category: 'reply',
    priority: 2,
    summary: 'Dana wants the deck.',
    actionItems: [],
    needsReply: true,
    draftReply: 'Sure, I will send it.',
    model: 'test',
    ...over,
  };
}

export function update(msg: Partial<EmailMessage> = {}, t: Partial<Triage> | null = {}): Update {
  return { key: 'acc1:m1', message: message(msg), triage: t === null ? undefined : triage(t), status: 'new' };
}
