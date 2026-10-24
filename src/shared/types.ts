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
}

export type Category = 'action' | 'reply' | 'fyi' | 'newsletter' | 'promo' | 'notification' | 'spam';

export const CATEGORIES: Category[] = ['action', 'reply', 'fyi', 'newsletter', 'promo', 'notification', 'spam'];

/** Categories that are never auto-replied to, whatever the settings say. */
export const NEVER_REPLY: Category[] = ['newsletter', 'promo', 'notification', 'spam'];

/** 1 = needs you today, 2 = normal, 3 = low. */
export type Priority = 1 | 2 | 3;

export interface Triage {
  category: Category;
  priority: Priority;
  summary: string;
  actionItems: string[];
  needsReply: boolean;
  draftReply: string;
  model: string;
}

export type UpdateStatus = 'new' | 'done' | 'snoozed';

export interface ReplyRecord {
  state: 'drafted' | 'sent' | 'skipped' | 'failed';
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
  ollama: { url: string; model: string };
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
  saveSettings(patch: Partial<Settings>): Promise<void>;
  listModels(): Promise<string[]>;
  onState(cb: (state: AppState) => void): () => void;
}
