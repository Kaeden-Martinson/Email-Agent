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
  permissions: AccountPermissions;
  imap?: ServerConfig;
  smtp?: ServerConfig;
  /** IMAP only: false when the SMTP server already files sent mail (Yahoo, AOL). */
  saveSentCopy?: boolean;
  webmailUrl?: string;
  lastSyncAt?: number;
  lastError?: string;
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
}

/** A sorting rule. Rules always win over the AI. */
export interface Rule {
  id: string;
  enabled: boolean;
  createdAt: number;
  /** Exactly one of sender (full address) or domain (example.com). */
  match: { sender?: string; domain?: string };
  effect: { priority?: Priority; category?: Category; hide?: boolean };
  origin: 'correction' | 'manual' | 'suggestion';
  hits: number;
  lastHitAt?: number;
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
  reply?: ReplyRecord;
  /** What the autopilot did on its own. */
  auto?: { archived?: boolean; labeled?: boolean; error?: string };
}

export interface Settings {
  /** The one person this PC's Pilot works for. */
  userName: string;
  onboarded: boolean;
  pollMinutes: number;
  lookbackHours: number;
  /** Daily briefing notification at `time` (HH:MM, local). */
  briefing: { enabled: boolean; time: string };
  /** fastModel: optional smaller model for simple emails; blank uses `model`. */
  ollama: { url: string; model: string; fastModel: string };
  /** Preview (dry-run): automatic actions become proposals you approve in Activity. */
  previewMode: boolean;
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
  act(key: string, action: UpdateAction): Promise<void>;
  sendReply(key: string, text: string, send: boolean): Promise<void>;
  redraft(key: string): Promise<void>;
  open(key: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Unsubscribes in the background where possible; otherwise returns a page to open. */
  unsubscribe(accountId: string, sender: string): Promise<{ message: string; openUrl?: string }>;
  briefNow(): Promise<void>;
  /** scope 'once' fixes this email only; 'sender' / 'domain' also create a rule. */
  correct(key: string, kind: CorrectionKind, scope: 'once' | 'sender' | 'domain'): Promise<void>;
  saveRule(rule: Omit<Rule, 'id' | 'createdAt' | 'hits'> & { id?: string }): Promise<void>;
  deleteRule(id: string): Promise<void>;
  approve(activityId: string): Promise<void>;
  reject(activityId: string): Promise<void>;
  undo(activityId: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  listModels(): Promise<string[]>;
  onState(cb: (state: AppState) => void): () => void;
}
