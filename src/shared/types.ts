// Types shared by the main process, the preload bridge and the renderer.

export type ProviderKind = 'gmail' | 'outlook' | 'imap';

export type ReplyMode = 'off' | 'draft' | 'send';

/** What the Pilot may do in one mailbox. */
export interface AccountPermissions {
  /** Desktop notification for priority-1 mail. */
  notify: boolean;
  /** Archive from the Pilot (moves mail in the real mailbox). */
  manage: boolean;
  /** off = suggest only, draft = save drafts in the mailbox, send = auto-send to trusted senders. */
  replies: ReplyMode;
  /** Auto-send only to these addresses or @domains; everyone else gets a draft. */
  trustedSenders: string[];
  signature: string;
  /** Tag mail in the real mailbox (Gmail labels, Outlook categories, IMAP keywords). */
  labels: boolean;
  /** Archive these categories automatically once summarized (needs `manage`). */
  autoClean: Category[];
  /** suggest = list senders to unsubscribe from; auto = also unsubscribe via one-click links. */
  unsubscribe: 'off' | 'suggest' | 'auto';
}

export const DEFAULT_PERMISSIONS: AccountPermissions = {
  notify: true,
  manage: true,
  replies: 'off',
  trustedSenders: [],
  signature: '',
  labels: false,
  autoClean: [],
  unsubscribe: 'suggest',
};

/** Parsed List-Unsubscribe / List-Unsubscribe-Post headers. */
export interface Unsubscribe {
  mailto?: string;
  url?: string;
  /** RFC 8058: the URL accepts a background POST, no page visit needed. */
  oneClick: boolean;
}

/** A bulk sender, grouped from the updates list. */
export interface Subscription {
  accountId: string;
  sender: string;
  name: string;
  count: number;
  lastAt: number;
  unsubscribe?: Unsubscribe;
  unsubscribedAt?: number;
  method?: string;
}

export interface Briefing {
  at: number;
  text: string;
  needYou: number;
  drafts: number;
}

/** host/port; `secure` = TLS from the start (993/465), otherwise STARTTLS. */
export interface ServerConfig {
  host: string;
  port: number;
  secure: boolean;
}

export interface Account {
  id: string;
  kind: ProviderKind;
  email: string;
  /** "Gmail", "Microsoft 365", "Yahoo Mail", ... */
  providerName: string;
  addedAt: number;
  /** The Pilot only reads mailboxes it is watching. */
  watching: boolean;
  /** "readonly" connections were granted read scopes only; Pilot never writes to them. Missing = full. */
  access?: 'full' | 'readonly';
  permissions: AccountPermissions;
  imap?: ServerConfig;
  smtp?: ServerConfig;
  /** IMAP only: false when the SMTP server already files sent mail (Yahoo, AOL). */
  saveSentCopy?: boolean;
  webmailUrl?: string;
  lastSyncAt?: number;
  lastSentScanAt?: number;
  lastError?: string;
  /** The sign-in expired or was revoked; the mailbox needs Reconnect (data is kept). */
  needsReconnect?: boolean;
  /** Free/busy calendar access was granted, so reply drafts can offer your free times. */
  calendar?: boolean;
}

/** What the Pilot worked out from an email address. */
export interface Discovery {
  email: string;
  kind: ProviderKind;
  providerName: string;
  imap?: ServerConfig;
  smtp?: ServerConfig;
  saveSentCopy?: boolean;
  webmailUrl?: string;
  /** Where to create an app password, for IMAP providers that need one. */
  appPasswordUrl?: string;
  note?: string;
}

export interface ConnectRequest extends Discovery {
  /** IMAP only. */
  password?: string;
  /** Google/Microsoft: ask for read-only permission instead of full access. */
  access?: 'full' | 'readonly';
  /** Also ask for free/busy calendar access (Gmail, Outlook). */
  calendar?: boolean;
}

/** A downloaded PDF attachment. */
export interface PdfFile {
  name: string;
  data: Uint8Array;
}

export interface Address {
  name: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  accountId: string;
  threadId: string;
  from: Address;
  replyTo?: Address;
  to: string[];
  subject: string;
  snippet: string;
  body: string;
  receivedAt: number;
  webLink: string;
  messageIdHeader?: string;
  references?: string;
  /** Mailing-list, bulk or machine-generated mail (List-Unsubscribe, Precedence, Auto-Submitted). */
  isBulk: boolean;
  unsubscribe?: Unsubscribe;
  unread?: boolean;
  /** Attached files, when the provider lists them up front (Gmail, IMAP). */
  attachments?: AttachmentInfo[];
  hasAttachments?: boolean;
  /** Text read from PDF attachments (capped). Empty string = looked, nothing readable. */
  attachmentText?: string;
  /** Names of the PDFs that text came from. */
  attachmentNames?: string[];
}

export interface AttachmentInfo {
  /** Provider's id for downloading it. */
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export type Category = 'action' | 'reply' | 'fyi' | 'newsletter' | 'promo' | 'notification' | 'spam';

export const CATEGORIES: Category[] = ['action', 'reply', 'fyi', 'newsletter', 'promo', 'notification', 'spam'];

/** Categories that are never auto-replied to, whatever the settings say. */
export const NEVER_REPLY: Category[] = ['newsletter', 'promo', 'notification', 'spam'];

/** 1 = needs you today, 2 = normal, 3 = low. */
export type Priority = 1 | 2 | 3;

/** Which pipeline stage classified an email: a user rule, deterministic rules, or the light or full model. */
export type TriageSource = 'rule' | 'fast' | 'light' | 'full';

export interface Triage {
  category: Category;
  priority: Priority;
  summary: string;
  actionItems: string[];
  needsReply: boolean;
  draftReply: string;
  model: string;
  source?: TriageSource;
  /** Milliseconds spent classifying. */
  ms?: number;
  /** Why it got this category and priority, shown to the user. */
  reason?: string;
  ruleId?: string;
  /** The user changed the category or priority by hand. */
  corrected?: boolean;
  /** Questions in the conversation still waiting on the user. */
  openQuestions?: string[];
  /** Things the user promised earlier in the conversation. */
  userPromises?: string[];
  /** 1-based positions in Update.thread the summary is based on. */
  sources?: number[];
  /** The user already replied after this message, so no reply is needed. */
  repliedAlready?: boolean;
  /** Raw model extraction; verified copies live in AppState.items. */
  keyItems?: KeyItemDraft[];
}

export type NotifyEvent = 'urgent' | 'reminder' | 'briefing' | 'deadline' | 'followup' | 'reply' | 'approval';

export const NOTIFY_EVENTS: NotifyEvent[] = ['urgent', 'reminder', 'briefing', 'deadline', 'followup', 'reply', 'approval'];

/** minimal = "you have an important email"; sender = who and subject; full = plus the summary. */
export type PrivacyLevel = 'minimal' | 'sender' | 'full';

export type NotifyChannel = 'desktop' | 'ntfy' | 'telegram';

/** A notification as stored while held (see core/notify.ts NoteInput). */
export interface NoteRecord {
  event: NotifyEvent;
  key: string;
  sender?: string;
  subject?: string;
  detail?: string;
  count?: number;
  safe?: string;
}

export interface ChannelSettings {
  enabled: boolean;
  level: PrivacyLevel;
  events: Record<NotifyEvent, boolean>;
}

export interface NotificationSettings {
  enabled: boolean;
  quiet: { enabled: boolean; start: string; end: string; allowUrgent: boolean };
  desktop: ChannelSettings;
  ntfy: ChannelSettings & { server: string; topic: string };
  telegram: ChannelSettings & { chatId: string };
  /** Phone notifications per hour before the rest are folded into one summary. */
  maxPerHour: number;
}

export interface ChannelStatus {
  /** A token/secret is stored (never sent to the UI). */
  hasSecret: boolean;
  lastSentAt?: number;
  lastError?: string;
}

export interface NotifierStatus {
  channels: Record<NotifyChannel, ChannelStatus>;
  held: number;
}

export type KeyItemKind = 'bill' | 'deadline' | 'appointment' | 'event' | 'delivery' | 'other';

export const KEY_ITEM_KINDS: KeyItemKind[] = ['bill', 'deadline', 'appointment', 'event', 'delivery', 'other'];

/** What the model extracts; verified against the email before it's shown (core/extract.ts). */
export interface KeyItemDraft {
  kind: KeyItemKind;
  title: string;
  /** YYYY-MM-DD or "". */
  date?: string;
  /** HH:MM or "". */
  time?: string;
  amount?: number;
  currency?: string;
  /** Sentence copied word for word from the email. */
  evidence?: string;
}

/** A bill, deadline, appointment, event or delivery, with where it came from and how sure Pilot is. */
export interface KeyItem {
  id: string;
  accountId: string;
  /** The email it came from (the newest, when several emails mention the same thing). */
  key: string;
  sender: string;
  subject: string;
  kind: KeyItemKind;
  title: string;
  at?: number;
  allDay: boolean;
  amount?: number;
  currency?: string;
  evidence: string;
  /** Every fact shown was stated word for word in the email. */
  explicit: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** Ambiguity, time-zone and conflict notes. */
  notes: string[];
  /** Every email that mentioned this same item (duplicates are merged). */
  sourceKeys: string[];
  /** Received time of the newest email mentioning it. */
  lastAt?: number;
  createdAt: number;
  status: 'open' | 'done' | 'dismissed';
}

export interface SearchHit {
  key: string;
  accountId: string;
  subject: string;
  from: string;
  at: number;
  snippet: string;
}

export interface Citation {
  n: number;
  kind: 'email' | 'item' | 'commitment';
  key?: string;
  title: string;
  from: string;
  at: number;
  excerpt: string;
}

export interface AskResult {
  question: string;
  answer: string;
  /** The model says the sources contain the answer. */
  found: boolean;
  /** Found and backed by at least one real citation. */
  verified: boolean;
  citations: Citation[];
  /** The emails that matched, whether or not the AI used them. */
  results: SearchHit[];
  semantic: boolean;
  ms: number;
}

export interface SearchStatus {
  semantic: boolean;
  model: string;
  indexed: number;
  total: number;
}

/** One message of a conversation, with quoted history stripped. */
export interface ThreadMessage {
  id: string;
  from: Address;
  at: number;
  fromMe: boolean;
  text: string;
}

/** A sorting rule. Rules always win over the AI. */
export interface Rule {
  id: string;
  enabled: boolean;
  createdAt: number;
  /**
   * At most one of sender (full address) or domain (example.com), optionally narrowed by words in the subject.
   * A subject-only rule applies to any sender.
   */
  match: { sender?: string; domain?: string; subjectContains?: string };
  effect: { priority?: Priority; category?: Category; hide?: boolean };
  origin: 'correction' | 'manual' | 'suggestion';
  hits: number;
  lastHitAt?: number;
}

export interface CleanupPreview {
  count: number;
  /** Matching emails in mailboxes where archiving is off or read-only; left alone. */
  skipped: number;
  examples: { from: string; subject: string }[];
}

/** What a rule written in plain English would do, before you save it. */
export interface RulePreview {
  match: Rule['match'];
  effect: Rule['effect'];
  description: string;
  /** Emails Pilot has now that the rule would apply to. */
  count: number;
  examples: { from: string; subject: string }[];
}

export type CorrectionKind = 'more' | 'less' | 'junk';

export interface Correction {
  at: number;
  key: string;
  sender: string;
  kind: CorrectionKind;
  source?: TriageSource;
  from: { category: Category; priority: Priority };
  to: { category: Category; priority: Priority };
}

export interface SuggestedRule {
  match: Rule['match'];
  effect: Rule['effect'];
  because: string;
}

export type ActivityAction = 'archive' | 'label' | 'draft' | 'send' | 'unsubscribe';

/** One entry in the audit trail of things Pilot did or proposes to do. */
export interface ActivityEntry {
  id: string;
  at: number;
  accountId: string;
  key?: string;
  subject?: string;
  sender?: string;
  action: ActivityAction;
  trigger: 'auto' | 'user';
  /** proposed = waiting for your approval (preview mode). */
  status: 'proposed' | 'done' | 'failed' | 'undone' | 'rejected';
  /** An automatic action that you approved. */
  approved?: boolean;
  reason: string;
  error?: string;
  /** Archive and label can be undone; send, draft and unsubscribe cannot. */
  undoable: boolean;
  category?: Category;
  replyText?: string;
  sendReply?: boolean;
  unsubscribeSender?: string;
}

/** A message you sent that asked something, tracked until they reply. */
export interface FollowUp {
  id: string;
  accountId: string;
  threadId: string;
  messageId: string;
  messageIdHeader?: string;
  references?: string;
  to: Address;
  subject: string;
  sentAt: number;
  /** The question or request in your email. */
  asked: string;
  /** When to nudge if there's no reply. */
  dueAt: number;
  dueReason: string;
  webLink: string;
  status: 'waiting' | 'replied' | 'done' | 'dismissed';
  repliedAt?: number;
  checkedAt?: number;
}

/** Something you said you'd do, from your sent mail or a conversation. */
export interface Commitment {
  id: string;
  accountId: string;
  text: string;
  dueAt?: number;
  source: 'sent' | 'conversation';
  subject: string;
  withWhom?: string;
  at: number;
  updateKey?: string;
  status: 'open' | 'done' | 'dismissed';
}

export type ReminderTarget =
  | { kind: 'update'; key: string }
  | { kind: 'item'; id: string }
  | { kind: 'followup'; id: string }
  | { kind: 'commitment'; id: string };

export interface Reminder {
  id: string;
  target: ReminderTarget;
  title: string;
  /** What you typed, e.g. "Friday if they haven't replied". */
  phrase: string;
  at: number;
  /** Skip the reminder if the reply it's about arrives first. */
  unlessReplied: boolean;
  createdAt: number;
  status: 'pending' | 'due' | 'resolved' | 'cancelled';
  note?: string;
}

/** An email waiting on your reply (computed from Updates). */
export interface OwedReply {
  key: string;
  accountId: string;
  from: Address;
  subject: string;
  receivedAt: number;
  openQuestions: string[];
  overdue: boolean;
}

export interface PipelineStats {
  bySource: Record<TriageSource, { count: number; avgMs: number; corrected: number }>;
  corrections: number;
}

export type UpdateStatus = 'new' | 'done' | 'snoozed';

export interface ReplyRecord {
  state: 'proposed' | 'drafted' | 'sent' | 'skipped' | 'failed';
  text: string;
  at: number;
  auto: boolean;
  note?: string;
}

/** One email as it appears on the updates list. */
export interface Update {
  key: string;
  message: EmailMessage;
  triage?: Triage;
  triageError?: string;
  status: UpdateStatus;
  snoozeUntil?: number;
  /** Snoozed until the sender writes again in this conversation. */
  snoozeUntilReply?: boolean;
  reply?: ReplyRecord;
  /** The conversation up to this message, oldest first (personal mail only). */
  thread?: ThreadMessage[];
  /** What the autopilot did on its own. */
  auto?: { archived?: boolean; labeled?: boolean; error?: string };
}

export interface Settings {
  /** The one person this PC's Pilot works for. */
  userName: string;
  onboarded: boolean;
  pollMinutes: number;
  lookbackHours: number;
  /** Nudge if nobody replied after this many working days. */
  followUpDays: number;
  /** Daily briefing at `time` (HH:MM, local), on the chosen days, with the chosen sections. */
  briefing: {
    enabled: boolean;
    time: string;
    days: 'everyday' | 'weekdays';
    sections: { urgent: boolean; deadlines: boolean; followups: boolean; approvals: boolean };
  };
  notifications: NotificationSettings;
  /** fastModel: optional smaller model for simple emails; blank uses `model`. */
  ollama: { url: string; model: string; fastModel: string; embedModel: string };
  /** Preview (dry-run): automatic actions become proposals you approve in Activity. */
  previewMode: boolean;
  /** Encrypt Pilot's data file with the OS keystore (DPAPI on Windows). */
  encryptAtRest: boolean;
  /** Start Pilot (hidden in the tray) when you sign in to Windows. Installed app only. */
  launchAtLogin: boolean;
  /** Tell me about new versions; nothing is installed without you. */
  updates: { check: boolean; feedUrl: string };
  /** Optional overrides for the OAuth clients built into the app. */
  google: { clientId: string; clientSecret: string };
  microsoft: { clientId: string; tenant: string };
  /** Reply rules shared by every mailbox; per-mailbox choices live in AccountPermissions. */
  autoReply: {
    categories: Category[];
    dailySendCap: number;
    tone: string;
    /** Add a line to auto-sent mail saying an assistant wrote it. */
    disclose: boolean;
  };
}

export interface UpdateInfo {
  checkedAt: number;
  available: boolean;
  latest?: string;
  url?: string;
  notes?: string;
  error?: string;
}

export interface AppInfo {
  version: string;
  /** Running from the installer (not `npm start`). */
  packaged: boolean;
  devMode: boolean;
  update?: UpdateInfo;
  /** Shown once when data had to be restored from a backup. */
  notice?: string;
}

export interface AppStatus {
  syncing: boolean;
  lastRunAt?: number;
  message?: string;
  ollamaOk?: boolean;
  demo?: boolean;
}

export interface AppState {
  accounts: Account[];
  updates: Update[];
  settings: Settings;
  status: AppStatus;
  briefing?: Briefing;
  subscriptions: Subscription[];
  rules: Rule[];
  suggestedRules: SuggestedRule[];
  /** Newest first, capped. */
  activity: ActivityEntry[];
  stats: PipelineStats;
  followUps: FollowUp[];
  commitments: Commitment[];
  reminders: Reminder[];
  owed: OwedReply[];
  items: KeyItem[];
  search: SearchStatus;
  notifier: NotifierStatus;
  app: AppInfo;
  /** Whether Google / Microsoft sign-in is configured in this build. */
  signIn: { gmail: boolean; outlook: boolean };
}

export type UpdateAction = 'done' | 'reopen' | 'archive' | 'snooze';

export interface AccountPatch {
  watching?: boolean;
  permissions?: Partial<AccountPermissions>;
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface Api {
  getState(): Promise<AppState>;
  discover(email: string): Promise<Discovery>;
  /** Signs in (OAuth) or verifies the password (IMAP); resolves with the account id. */
  connect(req: ConnectRequest): Promise<string>;
  /** Abandons a Google/Microsoft sign-in that is waiting on the browser. */
  cancelSignIn(): Promise<void>;
  updateAccount(id: string, patch: AccountPatch): Promise<void>;
  removeAccount(id: string): Promise<void>;
  syncNow(): Promise<void>;
  /** Resolves with the activity id for an archive, so it can be undone. */
  act(key: string, action: UpdateAction): Promise<string | void>;
  sendReply(key: string, text: string, send: boolean): Promise<void>;
  redraft(key: string): Promise<void>;
  open(key: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Unsubscribes in the background where possible; otherwise returns a page to open. */
  unsubscribe(accountId: string, sender: string): Promise<{ message: string; openUrl?: string }>;
  briefNow(): Promise<void>;
  /** scope 'once' fixes this email only; 'sender' / 'domain' also create a rule. */
  correct(key: string, kind: CorrectionKind, scope: 'once' | 'sender' | 'domain'): Promise<void>;
  dismissSuggestion(s: SuggestedRule): Promise<void>;
  doneMany(keys: string[]): Promise<void>;
  parseRule(text: string): Promise<RulePreview>;
  saveRule(rule: Omit<Rule, 'id' | 'createdAt' | 'hits'> & { id?: string }): Promise<void>;
  deleteRule(id: string): Promise<void>;
  approve(activityId: string): Promise<void>;
  reject(activityId: string): Promise<void>;
  undo(activityId: string): Promise<void>;
  /** Parses a reminder phrase without saving it, so the UI can show what it means. */
  previewWhen(phrase: string): Promise<{ at: number; unlessReplied: boolean; label: string } | { error: string }>;
  remind(target: ReminderTarget, phrase: string): Promise<void>;
  cancelReminder(id: string): Promise<void>;
  setFollowUp(id: string, status: FollowUp['status']): Promise<void>;
  setCommitment(id: string, status: Commitment['status']): Promise<void>;
  /** Saves a polite follow-up as a draft in your mailbox. Never sends. */
  draftNudge(followUpId: string): Promise<void>;
  setItem(id: string, status: KeyItem['status']): Promise<void>;
  search(query: string): Promise<{ hits: SearchHit[]; semantic: boolean; terms: string[] }>;
  ask(question: string): Promise<AskResult>;
  /** Downloads a local embedding model through Ollama and turns on semantic search. */
  enableSemantic(model: string): Promise<void>;
  testNotification(channel: NotifyChannel): Promise<void>;
  /** Stores an ntfy access token or Telegram bot token encrypted; "" removes it. Never read back. */
  setChannelSecret(channel: 'ntfy' | 'telegram', secret: string): Promise<void>;
  detectTelegramChat(): Promise<{ chatId: string; name: string }>;
  /** The full text of one email (state only carries a short preview, to stay fast). */
  getBody(key: string): Promise<string>;
  /** Three alternative replies (Brief, Friendly, Formal), conversation-aware. Nothing is sent. */
  /** Free times from the mailbox's calendar (free/busy only). */
  freeTimes(key: string): Promise<string[]>;
  /** "tomorrow", "nextweek", "reply" or plain English. Resolves with a description. */
  snooze(key: string, choice: string): Promise<string>;
  /** Which open emails a bulk cleanup would archive. Changes nothing. */
  cleanupPreview(f: { categories: Category[]; olderThanDays: number }): Promise<CleanupPreview>;
  /** Archives them (each logged in Activity and undoable). */
  cleanupRun(f: { categories: Category[]; olderThanDays: number }): Promise<{ archived: number; failed: number; skipped: number; ids: string[] }>;
  undoMany(ids: string[]): Promise<number>;
  previewSnooze(choice: string): Promise<{ label: string } | { error: string }>;
  replyOptions(key: string): Promise<{ tone: string; text: string }[]>;
  checkForUpdates(): Promise<void>;
  openFolder(which: 'logs' | 'data'): Promise<void>;
  dismissNotice(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  listModels(): Promise<string[]>;
  onState(cb: (state: AppState) => void): () => void;
}
